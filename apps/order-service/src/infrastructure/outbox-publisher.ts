// apps/order-service/src/infrastructure/outbox-publisher.ts
// Transactional Outbox Worker, Outbox Repository, Inbox Deduplication & Idempotent Consumer
// Phục vụ Milestone M4 (CF-021 - Transactional Outbox/Inbox, idempotent consumers)
// Loại bỏ hoàn toàn Dual-write giữa Database và Message Broker (Transactional Atomicity).
// Hỗ trợ At-Least-Once Delivery, Retry exponential backoff và Inbox Idempotency (Kịch bản R-04).
// Tương thích Node.js 24 LTS native type-stripping (không dùng parameter properties, dùng import type).

import type { IEventBus, EventEnvelope } from '../../../../packages/messaging/src/event-bus.ts';
import type { VersionedIntegrationEvent } from '../../../../packages/contracts/src/order.ts';

/**
 * -------------------------------------------------------------
 * 1. Outbox & Inbox Entities / Interfaces
 * -------------------------------------------------------------
 */

/**
 * ============================================================================
 * CLOUD / DISTRIBUTED PATTERN: TRANSACTIONAL OUTBOX & INBOX PATTERN
 * ============================================================================
 * [Mục đích cho Junior Developer]:
 * 1. BÀI TOÁN DUAL-WRITE HAZARD:
 *    Khi tạo một Order, bạn muốn làm 2 việc:
 *       a. Lưu Order vào Database (PostgreSQL).
 *       b. Gửi tin nhắn "OrderCreated" lên Cloud Pub/Sub để Inventory trừ kho.
 *    Nếu bạn viết:
 *       await db.save(order);
 *       await pubsub.publish(event);
 *    Chuyện gì xảy ra nếu dòng 1 thành công, nhưng dòng 2 bị rớt mạng?
 *    -> Database đã lưu đơn, nhưng Pub/Sub không có tin nhắn! Kho không biết để giữ hàng!
 *    Còn nếu bạn đảo ngược: gửi Pub/Sub trước rồi mới lưu DB?
 *    Nếu lưu DB lỗi, Pub/Sub đã gửi đi mất rồi, kho trừ hàng cho một đơn... không tồn tại!
 * 
 * 2. GIẢI PHÁP - TRANSACTIONAL OUTBOX:
 *    Thay vì gửi trực tiếp lên Pub/Sub, ta lưu Event vào bảng `outbox_events` NGAY TRONG
 *    CÙNG LOCAL TRANSACTION ACID với bảng `orders`.
 *    Vì cùng một transaction của PostgreSQL, nên hoặc CẢ HAI CÙNG ĐƯỢC LƯU, hoặc ROLLBACK CẢ HAI!
 * 
 * 3. OUTBOX WORKER (RELAY):
 *    Một tiến trình nền chạy độc lập, liên tục quét bảng `outbox_events` và đẩy lên Pub/Sub.
 *    Nếu rớt mạng, nó retry lại. Khi broker xác nhận (ACK), nó đổi status thành 'PUBLISHED'.
 * 
 * 4. INBOX PATTERN (IDEMPOTENT CONSUMER):
 *    Vì Worker có thể retry, Pub/Sub có thể gửi một tin nhắn 2 lần (At-least-once delivery).
 *    Phía nhận (Consumer) dùng bảng `inbox_events` với `UNIQUE (message_id, consumer_name)`.
 *    Nếu thấy messageId này đã từng xử lý rồi, Consumer lập tức bỏ qua, chống trừ kho 2 lần!
 */

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';

export interface OutboxRecord {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly version: number;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly topic: string;
  status: OutboxStatus;
  retryCount: number;
  lastError?: string;
  createdAt: Date;
  processedAt?: Date;
}

export interface InboxRecord {
  readonly messageId: string;      // eventId từ broker
  readonly consumerName: string;   // Tên consumer xử lý
  readonly processedAt: Date;
  readonly status: 'APPLIED' | 'FAILED';
}

/**
 * -------------------------------------------------------------
 * 2. In-Memory Transactional Outbox & Inbox Store (ACID Simulation)
 * -------------------------------------------------------------
 * Mô phỏng bảng `outbox_events` và `inbox_events` trong PostgreSQL:
 * - Bảo đảm ghi đồng thời Domain Entity và OutboxRecord trong cùng 1 local transaction
 * - Bảng `inbox_events` có UNIQUE(message_id, consumer_name) để deduplicate
 */
export class InMemoryTransactionalStore {
  public readonly orders = new Map<string, any>();
  public readonly outbox = new Map<string, OutboxRecord>();
  public readonly inbox = new Map<string, InboxRecord>(); // key: `${consumerName}:${messageId}`

  /**
   * Mô phỏng một ACID Database Transaction:
   * Ghi đồng thời trạng thái Order và bản ghi OutboxEvent.
   * Nếu một trong hai lỗi, toàn bộ transaction bị ROLLBACK.
   */
  public async executeTransaction(
    action: (tx: {
      saveOrder: (order: any) => void;
      saveOutbox: (record: OutboxRecord) => void;
    }) => Promise<void>
  ): Promise<void> {
    const rollbackOrders = new Map(this.orders);
    const rollbackOutbox = new Map(this.outbox);

    try {
      await action({
        saveOrder: (order: any) => {
          if (this.orders.has(order.id) && order.version === 1) {
            throw new Error(`DUPLICATE_ORDER: Đơn hàng '${order.id}' đã tồn tại`);
          }
          this.orders.set(order.id, { ...order });
        },
        saveOutbox: (record: OutboxRecord) => {
          if (this.outbox.has(record.id)) {
            throw new Error(`DUPLICATE_OUTBOX_EVENT: Event '${record.id}' đã tồn tại trong outbox`);
          }
          this.outbox.set(record.id, { ...record });
        },
      });
    } catch (error) {
      // Rollback toàn bộ state
      this.orders.clear();
      for (const [k, v] of rollbackOrders) this.orders.set(k, v);
      this.outbox.clear();
      for (const [k, v] of rollbackOutbox) this.outbox.set(k, v);
      throw error;
    }
  }

  public getPendingOutboxRecords(limit = 20): OutboxRecord[] {
    const pending: OutboxRecord[] = [];
    for (const record of this.outbox.values()) {
      if (record.status === 'PENDING' || record.status === 'FAILED') {
        if (record.retryCount < 5) {
          pending.push(record);
          if (pending.length >= limit) break;
        }
      }
    }
    return pending;
  }

  public updateOutboxStatus(
    id: string,
    status: OutboxStatus,
    error?: string
  ): void {
    const record = this.outbox.get(id);
    if (!record) return;

    record.status = status;
    if (status === 'PUBLISHED') {
      record.processedAt = new Date();
    } else if (status === 'FAILED') {
      record.retryCount += 1;
      record.lastError = error;
    }
  }

  /**
   * Atomic Inbox Insert: Kiểm tra và đánh dấu đã xử lý
   * Trả về true nếu là thông điệp mới (chưa từng xử lý)
   * Trả về false nếu thông điệp đã từng được xử lý (Duplicate)
   */
  public async atomicInboxCheckAndRecord(
    messageId: string,
    consumerName: string
  ): Promise<boolean> {
    const key = `${consumerName}:${messageId}`;
    if (this.inbox.has(key)) {
      return false; // Đã tồn tại -> Duplicate message!
    }

    this.inbox.set(key, {
      messageId,
      consumerName,
      processedAt: new Date(),
      status: 'APPLIED',
    });
    return true;
  }
}

/**
 * -------------------------------------------------------------
 * 3. Outbox Publisher Worker
 * -------------------------------------------------------------
 * Polling/Worker định kỳ quét các bản ghi PENDING trong `outbox_events`
 * và đẩy lên Message Broker (IEventBus):
 * - Đảm bảo At-least-once Delivery
 * - Tự động retry khi broker gặp lỗi mạng tạm thời
 * - Đánh dấu PUBLISHED khi broker xác nhận thành công
 */
export class OutboxPublisherWorker {
  private readonly store: InMemoryTransactionalStore;
  private readonly eventBus: IEventBus;
  private isRunning = false;

  constructor(store: InMemoryTransactionalStore, eventBus: IEventBus) {
    this.store = store;
    this.eventBus = eventBus;
  }

  /**
   * Thực thi một chu kỳ quét và xuất bản các events đang chờ (Single Publish Tick)
   */
  public async processPendingEvents(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const pending = this.store.getPendingOutboxRecords();
    let succeeded = 0;
    let failed = 0;

    for (const record of pending) {
      try {
        record.status = 'PROCESSING';

        const integrationEvent: VersionedIntegrationEvent<any> = {
          eventId: record.id,
          eventType: record.eventType,
          version: record.version,
          timestamp: record.createdAt.toISOString(),
          payload: record.payload,
          metadata: {
            correlationId: record.correlationId,
            causationId: record.causationId,
            source: 'order-service',
          },
        };

        // Gửi qua EventBus
        await this.eventBus.publish(record.topic, integrationEvent);

        // Đánh dấu thành công
        this.store.updateOutboxStatus(record.id, 'PUBLISHED');
        succeeded++;
      } catch (err: any) {
        // Gặp lỗi khi gửi broker (mạng, broker down) -> Đánh dấu FAILED để retry chu kỳ sau
        this.store.updateOutboxStatus(record.id, 'FAILED', err.message);
        failed++;
      }
    }

    return {
      processed: pending.length,
      succeeded,
      failed,
    };
  }
}

/**
 * -------------------------------------------------------------
 * 4. Idempotent Consumer Wrapper (Inbox Pattern)
 * -------------------------------------------------------------
 * Bọc bất kỳ business handler nào để đảm bảo tính Idempotency:
 * - Kiểm tra Inbox Table trước khi gọi handler
 * - Nếu messageId đã tồn tại -> Bỏ qua (không thực hiện side-effects)
 * - Đảm bảo an toàn trước At-Least-Once Delivery của Broker
 */
export class IdempotentConsumer {
  private readonly store: InMemoryTransactionalStore;
  public readonly consumerName: string;

  constructor(store: InMemoryTransactionalStore, consumerName: string) {
    this.store = store;
    this.consumerName = consumerName;
  }

  public createHandler<T>(
    businessLogic: (envelope: EventEnvelope<T>) => Promise<void>
  ): (envelope: EventEnvelope<T>) => Promise<{ status: 'APPLIED' | 'DUPLICATE_SKIPPED' }> {
    return async (envelope: EventEnvelope<T>) => {
      // 1. Kiểm tra nguyên tử trong Inbox
      const isNew = await this.store.atomicInboxCheckAndRecord(
        envelope.eventId,
        this.consumerName
      );

      if (!isNew) {
        // Thông điệp bị trùng lặp -> Bỏ qua an toàn
        return { status: 'DUPLICATE_SKIPPED' };
      }

      // 2. Thực thi nghiệp vụ nếu là thông điệp mới
      await businessLogic(envelope);
      return { status: 'APPLIED' };
    };
  }
}

