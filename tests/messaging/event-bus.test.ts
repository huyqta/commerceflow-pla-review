import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryEventBus,
  GcpPubSubAdapter,
  MessagingError,
} from '../../packages/messaging/src/event-bus.ts';
import type { EventEnvelope } from '../../packages/messaging/src/event-bus.ts';
import type { VersionedIntegrationEvent } from '../../packages/contracts/src/order.ts';

describe('1. In-Memory Event Bus Publish & Subscribe (Local Adapter)', () => {
  let bus: InMemoryEventBus;

  beforeEach(() => {
    bus = new InMemoryEventBus();
  });

  it('Publish một event và Subscriber nhận đúng dữ liệu Envelope', async () => {
    const receivedEvents: EventEnvelope[] = [];

    await bus.subscribe('orders.created', async (envelope) => {
      receivedEvents.push(envelope);
    });

    const event: VersionedIntegrationEvent<{ orderId: string; total: number }> = {
      eventId: 'evt-100',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { orderId: 'ORD-100', total: 500 },
      metadata: { source: 'order-service' },
    };

    await bus.publish('orders.created', event);

    assert.equal(receivedEvents.length, 1);
    assert.equal(receivedEvents[0].eventId, 'evt-100');
    assert.equal(receivedEvents[0].eventType, 'OrderCreated');
    assert.equal(receivedEvents[0].payload.orderId, 'ORD-100');
    assert.equal(receivedEvents[0].source, 'order-service');
  });

  it('Fan-out: Nhiều subscribers trên cùng 1 topic đều nhận được event', async () => {
    let sub1Calls = 0;
    let sub2Calls = 0;

    await bus.subscribe('orders.created', async () => {
      sub1Calls++;
    });

    await bus.subscribe('orders.created', async () => {
      sub2Calls++;
    });

    await bus.publish('orders.created', {
      eventId: 'evt-200',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { orderId: 'ORD-200' },
    });

    assert.equal(sub1Calls, 1);
    assert.equal(sub2Calls, 1);
  });

  it('Unsubscribe: Sau khi hủy đăng ký, subscriber không còn nhận sự kiện mới', async () => {
    let callCount = 0;
    const sub = await bus.subscribe('orders.created', async () => {
      callCount++;
    });

    // Publish lần 1 -> nhận
    await bus.publish('orders.created', {
      eventId: 'evt-301',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { orderId: 'ORD-301' },
    });
    assert.equal(callCount, 1);

    // Hủy đăng ký
    await sub.unsubscribe();

    // Publish lần 2 -> không tăng
    await bus.publish('orders.created', {
      eventId: 'evt-302',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { orderId: 'ORD-302' },
    });
    assert.equal(callCount, 1);
  });
});

describe('2. Thử thách độc lập: Truy vết Phân tán (Distributed Tracing với eventId & correlationId)', () => {
  let bus: InMemoryEventBus;

  beforeEach(() => {
    bus = new InMemoryEventBus();
  });

  it('Thử thách độc lập: correlationId được bảo toàn xuyên suốt chuỗi Order -> Inventory -> Payment', async () => {
    const correlationId = 'corr-tx-abc-123';
    const traceChain: { service: string; correlationId: string; causationId?: string }[] = [];

    // 1. Order Service phát OrderCreated với correlationId ban đầu
    await bus.subscribe('orders.created', async (envelope) => {
      traceChain.push({
        service: 'inventory-service',
        correlationId: envelope.correlationId,
        causationId: envelope.eventId,
      });

      // 2. Inventory Service phát tiếp InventoryReserved mang theo correlationId cũ và causationId = eventId trước
      await bus.publish('inventory.reserved', {
        eventId: 'evt-inv-401',
        eventType: 'InventoryReserved',
        version: 1,
        timestamp: new Date().toISOString(),
        payload: { reservationId: 'res-1' },
        metadata: {
          correlationId: envelope.correlationId,
          causationId: envelope.eventId,
          source: 'inventory-service',
        },
      });
    });

    // 3. Payment Service lắng nghe InventoryReserved
    await bus.subscribe('inventory.reserved', async (envelope) => {
      traceChain.push({
        service: 'payment-service',
        correlationId: envelope.correlationId,
        causationId: envelope.causationId,
      });
    });

    // Kích hoạt chuỗi sự kiện
    await bus.publish('orders.created', {
      eventId: 'evt-ord-101',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { orderId: 'ORD-101' },
      metadata: {
        correlationId,
        source: 'order-service',
      },
    });

    assert.equal(traceChain.length, 2);
    // Cả 2 service đều có chung correlationId
    assert.equal(traceChain[0].correlationId, correlationId);
    assert.equal(traceChain[1].correlationId, correlationId);
    // CausationId móc nối đúng mắt xích
    assert.equal(traceChain[0].causationId, 'evt-ord-101');
    assert.equal(traceChain[1].causationId, 'evt-ord-101');
  });

  it('Tự động tạo correlationId mặc định nếu publisher không cung cấp', async () => {
    let capturedCorrelationId = '';
    await bus.subscribe('orders.events', async (envelope) => {
      capturedCorrelationId = envelope.correlationId;
    });

    await bus.publish('orders.events', {
      eventId: 'evt-no-corr-999',
      eventType: 'OrderCancelled',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { orderId: 'ORD-999' },
    });

    assert.ok(capturedCorrelationId.startsWith('corr-evt-no-corr-999'));
  });
});

describe('3. Kịch bản R-04: At-least-once Delivery & Chống Duplicate Processing (Idempotent Consumer)', () => {
  let bus: InMemoryEventBus;

  beforeEach(() => {
    bus = new InMemoryEventBus();
  });

  it('Kịch bản R-04: Khi Broker gửi trùng lặp 1 eventId 2 lần, Idempotent Consumer chỉ thực thi side effect 1 lần duy nhất', async () => {
    const processedEventIds = new Set<string>();
    let sideEffectExecutionCount = 0;

    // Consumer áp dụng mẫu Inbox Pattern / Idempotency Key check
    await bus.subscribe('orders.created', async (envelope) => {
      if (processedEventIds.has(envelope.eventId)) {
        // Trùng lặp event -> Bỏ qua an toàn (Idempotent ignore)
        return;
      }
      processedEventIds.add(envelope.eventId);
      sideEffectExecutionCount++;
    });

    const duplicateEvent: VersionedIntegrationEvent<{ orderId: string }> = {
      eventId: 'evt-dup-888',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { orderId: 'ORD-888' },
    };

    // Giả lập gửi 2 lần cùng một eventId
    await bus.simulateDuplicateDelivery('orders.created', duplicateEvent);

    assert.equal(sideEffectExecutionCount, 1, 'Side effect chỉ được phép thực thi chính xác 1 lần');
  });
});

describe('4. GCP Cloud Pub/Sub Adapter (Spec & Negative Cases)', () => {
  it('GcpPubSubAdapter serialize payload và đính kèm đầy đủ Pub/Sub attributes', async () => {
    let publishedMessageData: Buffer | null = null;
    let publishedAttributes: Record<string, string> | null = null;

    const mockGcpClient = {
      topic: (_topicName: string) => ({
        publishMessage: async (msg: { data: Buffer; attributes: Record<string, string> }) => {
          publishedMessageData = msg.data;
          publishedAttributes = msg.attributes;
        },
      }),
    };

    const gcpAdapter = new GcpPubSubAdapter(
      { projectId: 'commerceflow-cloud', topicPrefix: 'cf' },
      mockGcpClient
    );

    const event: VersionedIntegrationEvent<{ orderId: string }> = {
      eventId: 'evt-gcp-1',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { orderId: 'ORD-GCP-1' },
      metadata: {
        correlationId: 'corr-gcp-1',
        source: 'order-service',
      },
    };

    await gcpAdapter.publish('orders', event);

    assert.ok(publishedMessageData);
    const parsedData = JSON.parse(publishedMessageData!.toString());
    assert.equal(parsedData.orderId, 'ORD-GCP-1');

    assert.equal(publishedAttributes!['eventId'], 'evt-gcp-1');
    assert.equal(publishedAttributes!['eventType'], 'OrderCreated');
    assert.equal(publishedAttributes!['correlationId'], 'corr-gcp-1');
    assert.equal(publishedAttributes!['source'], 'order-service');
  });

  it('Negative Case: Từ chối publish khi topic rỗng hoặc eventId không hợp lệ', async () => {
    const bus = new InMemoryEventBus();

    await assert.rejects(
      async () => bus.publish('', { eventId: 'e1', eventType: 'OrderCreated', version: 1, timestamp: '', payload: {} }),
      (err: any) => {
        assert.ok(err instanceof MessagingError);
        assert.equal(err.code, 'INVALID_TOPIC');
        return true;
      }
    );

    await assert.rejects(
      async () => bus.publish('topic-a', { eventId: '', eventType: 'OrderCreated', version: 1, timestamp: '', payload: {} }),
      (err: any) => {
        assert.ok(err instanceof MessagingError);
        assert.equal(err.code, 'INVALID_EVENT');
        return true;
      }
    );
  });

  it('Negative Case: Từ chối publish/subscribe sau khi EventBus đã đóng (close)', async () => {
    const bus = new InMemoryEventBus();
    await bus.close();

    await assert.rejects(
      async () => bus.publish('topic', { eventId: 'e1', eventType: 'OrderCreated', version: 1, timestamp: '', payload: {} }),
      (err: any) => {
        assert.ok(err instanceof MessagingError);
        assert.equal(err.code, 'BUS_CLOSED');
        return true;
      }
    );
  });
});

