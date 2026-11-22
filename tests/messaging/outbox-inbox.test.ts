import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryTransactionalStore,
  OutboxPublisherWorker,
  IdempotentConsumer,
} from '../../apps/order-service/src/infrastructure/outbox-publisher.ts';
import { InMemoryEventBus } from '../../packages/messaging/src/event-bus.ts';
import type { OutboxRecord } from '../../apps/order-service/src/infrastructure/outbox-publisher.ts';
import type { EventEnvelope } from '../../packages/messaging/src/event-bus.ts';

describe('1. Transactional Atomicity (Loại bỏ Dual-Write Anti-pattern)', () => {
  let store: InMemoryTransactionalStore;

  beforeEach(() => {
    store = new InMemoryTransactionalStore();
  });

  it('Transaction thành công: Ghi đồng thời trạng thái Order và OutboxRecord vào cùng 1 transaction boundary', async () => {
    const orderData = { id: 'ORD-101', status: 'PENDING', totalAmount: 500, version: 1 };
    const outboxData: OutboxRecord = {
      id: 'evt-ord-101',
      aggregateType: 'Order',
      aggregateId: 'ORD-101',
      eventType: 'OrderCreated',
      payload: { orderId: 'ORD-101', totalAmount: 500 },
      version: 1,
      correlationId: 'corr-101',
      topic: 'orders.created',
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
    };

    await store.executeTransaction(async (tx) => {
      tx.saveOrder(orderData);
      tx.saveOutbox(outboxData);
    });

    assert.equal(store.orders.size, 1);
    assert.equal(store.outbox.size, 1);
    assert.equal(store.orders.get('ORD-101').status, 'PENDING');
    assert.equal(store.outbox.get('evt-ord-101').status, 'PENDING');
  });

  it('Transaction Rollback: Khi ghi Outbox gặp lỗi (ví dụ duplicate event ID), toàn bộ Order cũng bị hủy bỏ (0 Orphan Records)', async () => {
    // Đã có sẵn 1 bản ghi outbox trùng ID
    store.outbox.set('evt-dup-id', {
      id: 'evt-dup-id',
      aggregateType: 'Order',
      aggregateId: 'ORD-OLD',
      eventType: 'OrderCreated',
      payload: {},
      version: 1,
      correlationId: 'c1',
      topic: 'orders',
      status: 'PUBLISHED',
      retryCount: 0,
      createdAt: new Date(),
    });

    const newOrder = { id: 'ORD-999', status: 'PENDING', version: 1 };

    await assert.rejects(
      async () => {
        await store.executeTransaction(async (tx) => {
          tx.saveOrder(newOrder); // Ghi order
          // Cố tình ghi outbox trùng ID -> Ném lỗi!
          tx.saveOutbox({
            id: 'evt-dup-id',
            aggregateType: 'Order',
            aggregateId: 'ORD-999',
            eventType: 'OrderCreated',
            payload: {},
            version: 1,
            correlationId: 'c2',
            topic: 'orders',
            status: 'PENDING',
            retryCount: 0,
            createdAt: new Date(),
          });
        });
      },
      (err: any) => {
        assert.match(err.message, /DUPLICATE_OUTBOX_EVENT/);
        return true;
      }
    );

    // Kiểm chứng Atomicity: Order ORD-999 KHÔNG được lưu (Rollback sạch sẽ)
    assert.equal(store.orders.has('ORD-999'), false, 'Order không được lưu nếu outbox thất bại');
  });
});

describe('2. Outbox Publisher Worker (At-least-once Delivery & Exponential Retry)', () => {
  let store: InMemoryTransactionalStore;
  let eventBus: InMemoryEventBus;
  let worker: OutboxPublisherWorker;

  beforeEach(() => {
    store = new InMemoryTransactionalStore();
    eventBus = new InMemoryEventBus();
    worker = new OutboxPublisherWorker(store, eventBus);
  });

  it('Worker quét các bản ghi PENDING, publish lên broker và cập nhật status = PUBLISHED', async () => {
    // 1. Tạo 2 bản ghi outbox PENDING
    store.outbox.set('evt-1', {
      id: 'evt-1',
      aggregateType: 'Order',
      aggregateId: 'O-1',
      eventType: 'OrderCreated',
      payload: { id: 'O-1' },
      version: 1,
      correlationId: 'c-1',
      topic: 'orders.created',
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
    });

    store.outbox.set('evt-2', {
      id: 'evt-2',
      aggregateType: 'Order',
      aggregateId: 'O-2',
      eventType: 'OrderCreated',
      payload: { id: 'O-2' },
      version: 1,
      correlationId: 'c-2',
      topic: 'orders.created',
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
    });

    // 2. Chạy worker tick
    const result = await worker.processPendingEvents();
    assert.equal(result.processed, 2);
    assert.equal(result.succeeded, 2);
    assert.equal(result.failed, 0);

    // 3. Kiểm chứng trạng thái trong store
    assert.equal(store.outbox.get('evt-1')?.status, 'PUBLISHED');
    assert.equal(store.outbox.get('evt-2')?.status, 'PUBLISHED');
    assert.ok(store.outbox.get('evt-1')?.processedAt);

    // 4. Kiểm chứng broker đã nhận đủ 2 events
    assert.equal(eventBus.getPublishedEvents().length, 2);
  });

  it('Worker retry khi Broker gặp lỗi tạm thời (Network / Broker Down)', async () => {
    // Giả lập EventBus bị lỗi publish
    const faultyBus: any = {
      publish: async () => {
        throw new Error('NETWORK_TIMEOUT: Broker không phản hồi');
      },
    };
    const faultyWorker = new OutboxPublisherWorker(store, faultyBus);

    store.outbox.set('evt-fail', {
      id: 'evt-fail',
      aggregateType: 'Order',
      aggregateId: 'O-FAIL',
      eventType: 'OrderCreated',
      payload: {},
      version: 1,
      correlationId: 'c-fail',
      topic: 'orders.created',
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
    });

    const result = await faultyWorker.processPendingEvents();
    assert.equal(result.failed, 1);
    assert.equal(result.succeeded, 0);

    const record = store.outbox.get('evt-fail')!;
    assert.equal(record.status, 'FAILED');
    assert.equal(record.retryCount, 1);
    assert.match(record.lastError || '', /NETWORK_TIMEOUT/);
  });
});

describe('3. Idempotent Consumer & Inbox Deduplication (Kịch bản R-04 & Thử thách độc lập)', () => {
  let store: InMemoryTransactionalStore;

  beforeEach(() => {
    store = new InMemoryTransactionalStore();
  });

  it('Thử thách độc lập: Thử publish 2 lần cùng eventId -> Inbox Deduplication chặn side effect lần 2', async () => {
    const consumer = new IdempotentConsumer(store, 'inventory-service-consumer');
    let inventoryDeductionCount = 0;

    const handler = consumer.createHandler(async (envelope: EventEnvelope<{ productId: string; qty: number }>) => {
      // Giả lập side-effect trừ tồn kho
      inventoryDeductionCount += envelope.payload.qty;
    });

    const envelope: EventEnvelope<{ productId: string; qty: number }> = {
      eventId: 'evt-order-dup-777',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { productId: 'PROD-A', qty: 2 },
      correlationId: 'corr-777',
      source: 'order-service',
    };

    // Lần 1: Thông điệp mới -> Thực thi bình thường (APPLIED)
    const res1 = await handler(envelope);
    assert.equal(res1.status, 'APPLIED');
    assert.equal(inventoryDeductionCount, 2);

    // Lần 2: Giả lập Broker gửi lại cùng eventId -> Bỏ qua an toàn (DUPLICATE_SKIPPED)
    const res2 = await handler(envelope);
    assert.equal(res2.status, 'DUPLICATE_SKIPPED');
    assert.equal(inventoryDeductionCount, 2, 'Tồn kho không được phép bị trừ thêm lần 2!');

    // Lần 3: Gửi lại lần thứ 3 -> Vẫn bỏ qua an toàn
    const res3 = await handler(envelope);
    assert.equal(res3.status, 'DUPLICATE_SKIPPED');
    assert.equal(inventoryDeductionCount, 2);
  });

  it('Nhiều Consumers khác nhau cùng xử lý 1 eventId mà không bị xung đột inbox', async () => {
    const consumerA = new IdempotentConsumer(store, 'consumer-A');
    const consumerB = new IdempotentConsumer(store, 'consumer-B');

    let aCalled = 0;
    let bCalled = 0;

    const handlerA = consumerA.createHandler(async () => { aCalled++; });
    const handlerB = consumerB.createHandler(async () => { bCalled++; });

    const envelope: EventEnvelope = {
      eventId: 'evt-shared-123',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: {},
      correlationId: 'corr-123',
      source: 'order-service',
    };

    // Cả Consumer A và B đều được xử lý 1 lần cho event này
    const resA = await handlerA(envelope);
    const resB = await handlerB(envelope);

    assert.equal(resA.status, 'APPLIED');
    assert.equal(resB.status, 'APPLIED');
    assert.equal(aCalled, 1);
    assert.equal(bCalled, 1);

    // Gửi lại cho A -> A bỏ qua
    const resA2 = await handlerA(envelope);
    assert.equal(resA2.status, 'DUPLICATE_SKIPPED');
    assert.equal(aCalled, 1);
  });
});

