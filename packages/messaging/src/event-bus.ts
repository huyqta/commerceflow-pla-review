// packages/messaging/src/event-bus.ts
// Event Bus Abstraction & Pub/Sub Adapters (Local In-Memory & Cloud Pub/Sub Interface)
// Phục vụ Milestone M4 (CF-020 - Event bus abstraction và Pub/Sub adapter)
// Đáp ứng kịch bản R-04 (Duplicate Delivery / Idempotent Consumer) & Phân tán sự kiện
// Hỗ trợ truy vết phân tán (Distributed Tracing) qua correlationId và causationId.
// Tương thích Node.js 24 LTS native type-stripping (không dùng parameter properties, dùng import type).

import type { VersionedIntegrationEvent, EventMetadata } from '../../contracts/src/order.ts';

/**
 * ============================================================================
 * CLOUD / DISTRIBUTED PATTERN: EVENT ENVELOPE & DISTRIBUTED TRACING
 * ============================================================================
 * [Mục đích cho Junior Developer]:
 * 1. EVENT ENVELOPE (BÌ THƯ SỰ KIỆN):
 *    Tại sao không gửi mỗi object `{ orderId: "123", amount: 50000 }` lên queue?
 *    -> Khi gửi một lá thư qua bưu điện, bạn không gửi một tờ giấy trần trụi.
 *       Bạn phải bỏ nó vào một BÌ THƯ (Envelope) có ghi:
 *       - Người gửi (`source`): Service nào bắn ra?
 *       - Thời gian (`timestamp`): Phát ra lúc nào?
 *       - Loại thư (`eventType`): Thư chúc mừng hay giấy báo nợ?
 *       - Phiên bản (`version`): Tránh trường hợp Consumer phiên bản cũ đọc nhầm format mới.
 * 
 * 2. CORRELATION ID & CAUSATION ID (TRUY VẾT PHÂN TÁN):
 *    - `correlationId`: Tưởng tượng bạn gọi tổng đài khám bệnh và được cấp "Mã hồ sơ bệnh án: #12345".
 *      Bạn đi chụp X-quang, thử máu, lấy thuốc... ở phòng ban nào cũng kẹp theo mã #12345.
 *      Khi hệ thống gặp lỗi, kỹ sư chỉ cần tìm `correlationId = #12345` trên Cloud Logging
 *      là xem được trọn vẹn toàn bộ hành trình của request qua 10 microservices khác nhau!
 *    - `causationId`: ID của sự kiện cha trực tiếp kích hoạt ra sự kiện này (quan hệ nhân quả).
 */
export interface EventEnvelope<T = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly version: number;
  readonly timestamp: string;
  readonly payload: T;
  readonly correlationId: string; // ID chuỗi giao dịch xuyên suốt nhiều services
  readonly causationId?: string;  // ID của event/command trực tiếp sinh ra event này
  readonly source: string;        // Tên service phát ra event
}

export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => Promise<void>;

export interface Subscription {
  readonly subscriptionId: string;
  readonly topic: string;
  unsubscribe(): Promise<void>;
}

export interface IEventBus {
  /**
   * Xuất bản (Publish) một sự kiện vào Topic tương ứng
   */
  publish<T = unknown>(topic: string, event: VersionedIntegrationEvent<T>): Promise<void>;

  /**
   * Đăng ký (Subscribe) lắng nghe sự kiện trên Topic cụ thể
   */
  subscribe<T = unknown>(topic: string, handler: EventHandler<T>): Promise<Subscription>;

  /**
   * Đóng kết nối bus
   */
  close(): Promise<void>;
}

export class MessagingError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'MESSAGING_ERROR') {
    super(message);
    this.name = 'MessagingError';
    this.code = code;
  }
}

/**
 * -------------------------------------------------------------
 * 2. In-Memory Event Bus (Local Testing & Development Adapter)
 * -------------------------------------------------------------
 * Mô phỏng hàng đợi Pub/Sub trong tiến trình (In-Process Message Broker):
 * - Hỗ trợ đăng ký nhiều handlers trên cùng 1 topic (Fan-out)
 * - Tự động đính kèm hoặc bảo toàn eventId, correlationId, causationId
 * - Hỗ trợ mô phỏng At-Least-Once Delivery (Duplicate Message Delivery để test kịch bản R-04)
 */
export class InMemoryEventBus implements IEventBus {
  private readonly handlers = new Map<string, Map<string, EventHandler<any>>>();
  private readonly publishedHistory: { topic: string; event: EventEnvelope<any> }[] = [];
  private isClosed = false;

  public async publish<T = unknown>(
    topic: string,
    event: VersionedIntegrationEvent<T>
  ): Promise<void> {
    if (this.isClosed) {
      throw new MessagingError('BUS_ALREADY_CLOSED: Không thể publish sự kiện khi EventBus đã đóng', 'BUS_CLOSED');
    }

    if (!topic || typeof topic !== 'string' || topic.trim() === '') {
      throw new MessagingError('INVALID_TOPIC: Topic không được để trống', 'INVALID_TOPIC');
    }

    if (!event || !event.eventId || !event.eventType) {
      throw new MessagingError('INVALID_EVENT: Event phải có eventId và eventType hợp lệ', 'INVALID_EVENT');
    }

    // Đóng gói thành EventEnvelope chuẩn hóa
    const envelope: EventEnvelope<T> = {
      eventId: event.eventId,
      eventType: event.eventType,
      version: event.version ?? 1,
      timestamp: event.timestamp || new Date().toISOString(),
      payload: event.payload,
      correlationId: event.metadata?.correlationId || `corr-${event.eventId}`,
      causationId: event.metadata?.causationId,
      source: event.metadata?.source || 'unknown-service',
    };

    this.publishedHistory.push({ topic, event: envelope });

    const topicHandlers = this.handlers.get(topic);
    if (topicHandlers && topicHandlers.size > 0) {
      // Kích hoạt tất cả subscribers bất đồng bộ
      const promises: Promise<void>[] = [];
      for (const handler of topicHandlers.values()) {
        promises.push(
          Promise.resolve().then(() => handler(envelope)).catch((err) => {
            // Không để lỗi của 1 subscriber làm crash toàn bộ bus
            console.error(`[InMemoryEventBus] Lỗi khi xử lý event ${envelope.eventType} tại topic ${topic}:`, err);
          })
        );
      }
      await Promise.all(promises);
    }
  }

  public async subscribe<T = unknown>(
    topic: string,
    handler: EventHandler<T>
  ): Promise<Subscription> {
    if (this.isClosed) {
      throw new MessagingError('BUS_ALREADY_CLOSED: Không thể subscribe khi EventBus đã đóng', 'BUS_CLOSED');
    }

    if (!topic || typeof topic !== 'string') {
      throw new MessagingError('INVALID_TOPIC: Topic không được để trống', 'INVALID_TOPIC');
    }

    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, new Map());
    }

    const subId = `sub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const topicMap = this.handlers.get(topic)!;
    topicMap.set(subId, handler);

    return {
      subscriptionId: subId,
      topic,
      unsubscribe: async () => {
        topicMap.delete(subId);
        if (topicMap.size === 0) {
          this.handlers.delete(topic);
        }
      },
    };
  }

  /**
   * Phương thức hỗ trợ kiểm thử Kịch bản R-04:
   * Giả lập gửi lặp lại 1 thông điệp 2 lần (At-least-once Duplicate Delivery)
   */
  public async simulateDuplicateDelivery<T = unknown>(
    topic: string,
    event: VersionedIntegrationEvent<T>
  ): Promise<void> {
    await this.publish(topic, event);
    await this.publish(topic, event); // Gửi lần 2 với cùng eventId
  }

  public getPublishedEvents(): ReadonlyArray<{ topic: string; event: EventEnvelope<any> }> {
    return [...this.publishedHistory];
  }

  public clearHistory(): void {
    this.publishedHistory.length = 0;
  }

  public async close(): Promise<void> {
    this.isClosed = true;
    this.handlers.clear();
  }
}

/**
 * -------------------------------------------------------------
 * 3. GCP Cloud Pub/Sub Adapter (Architecture & Spec Interface)
 * -------------------------------------------------------------
 * Adapter cho môi trường Cloud Run / Production (kết nối với Google Cloud Pub/Sub):
 * - Serialize JSON payload thành Buffer
 * - Đính kèm Pub/Sub Message Attributes: correlationId, eventType, version
 * - Không tự động tạo tài nguyên cloud thật khi chạy unit test / micro-lab
 */
export interface GcpPubSubConfig {
  readonly projectId: string;
  readonly topicPrefix?: string;
  readonly clientCredentials?: unknown; // Dùng Service Account IAM
}

export class GcpPubSubAdapter implements IEventBus {
  public readonly config: GcpPubSubConfig;
  private readonly client: any;
  private isClosed = false;

  constructor(config: GcpPubSubConfig, mockClient?: any) {
    this.config = config;
    this.client = mockClient || null;
  }

  public async publish<T = unknown>(
    topic: string,
    event: VersionedIntegrationEvent<T>
  ): Promise<void> {
    if (this.isClosed) {
      throw new MessagingError('BUS_CLOSED', 'BUS_CLOSED');
    }

    const fullTopic = this.config.topicPrefix ? `${this.config.topicPrefix}.${topic}` : topic;

    // Chuẩn bị attributes cho Message Filtering và Distributed Tracing
    const attributes: Record<string, string> = {
      eventId: event.eventId,
      eventType: event.eventType,
      version: String(event.version ?? 1),
      correlationId: event.metadata?.correlationId || `corr-${event.eventId}`,
      source: event.metadata?.source || 'commerceflow',
    };

    if (event.metadata?.causationId) {
      attributes.causationId = event.metadata.causationId;
    }

    if (this.client?.topic) {
      const topicObj = this.client.topic(fullTopic);
      const dataBuffer = Buffer.from(JSON.stringify(event.payload));
      await topicObj.publishMessage({ data: dataBuffer, attributes });
    }
  }

  public async subscribe<T = unknown>(
    topic: string,
    handler: EventHandler<T>
  ): Promise<Subscription> {
    if (this.isClosed) {
      throw new MessagingError('BUS_CLOSED', 'BUS_CLOSED');
    }

    const subId = `gcp-sub-${topic}`;
    return {
      subscriptionId: subId,
      topic,
      unsubscribe: async () => {},
    };
  }

  public async close(): Promise<void> {
    this.isClosed = true;
  }
}

