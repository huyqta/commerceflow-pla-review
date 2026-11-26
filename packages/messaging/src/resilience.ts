// packages/messaging/src/resilience.ts
// Resilience Policies: Bounded Exponential Backoff with Jitter,
// Error Classification (Transient vs Permanent) & Dead-Letter Queue (DLQ) with Replay
// Phục vụ Milestone M4 (CF-023 - Resilience, retries, dead-letter và failure injection)
// Tương thích Node.js 24 LTS native type-stripping (không dùng parameter properties, dùng import type).

import type { IEventBus, EventEnvelope } from './event-bus.ts';

/**
 * ============================================================================
 * CLOUD / RESILIENCE PATTERN: ERROR CLASSIFICATION, RETRY WITH JITTER & DLQ
 * ============================================================================
 * [Mục đích cho Junior Developer]:
 * 1. PHÂN LOẠI LỖI (ERROR CLASSIFICATION):
 *    Không phải lỗi nào cũng được phép Retry!
 *    - LỖI VĨNH VIỄN (PERMANENT): 400 Bad Request, sai validation schema, JSON hỏng.
 *      Dù bạn có retry 100 lần thì input sai vẫn sai! Retry lúc này chỉ làm tốn CPU và vô ích.
 *    - LỖI TẠM THỜI (TRANSIENT): 503 Service Unavailable, 504 Gateway Timeout, rớt mạng 100ms.
 *      Những lỗi này chỉ xuất hiện chớp nhoáng, thử lại sau vài giây sẽ thành công.
 * 
 * 2. EXPONENTIAL BACKOFF VỚI JITTER:
 *    - Exponential Backoff: Lần 1 chờ 100ms, lần 2 chờ 200ms, lần 3 chờ 400ms...
 *      Tránh việc client bắn request dồn dập làm server quá tải thêm.
 *    - Jitter (Nhiễu ngẫu nhiên): Thêm một khoảng thời gian ngẫu nhiên (ví dụ 100ms + random(50ms)).
 *      Nếu không có Jitter, khi server phục hồi sau sự cố, 10.000 clients đang retry
 *      sẽ ĐỒNG LOẠT gửi request tại CÙNG MỘT GIÂY (Thundering Herd Problem), đánh sập server lần 2!
 * 
 * 3. DEAD-LETTER QUEUE (DLQ):
 *    - Nếu một tin nhắn đã retry tối đa (ví dụ 3 lần) mà vẫn thất bại, ta không thể vứt bỏ nó,
 *      cũng không thể để nó đứng chặn đầu hàng đợi làm nghẽn các tin nhắn khác (Head-of-Line Blocking).
 *    - Giải pháp: Đẩy tin nhắn hỏng này vào "Nghĩa địa tin nhắn" (Dead-Letter Queue).
 *      Tiến trình xử lý các message khác vẫn tiếp tục bình thường.
 *      Kỹ sư On-call sẽ kiểm tra DLQ, sửa lỗi hệ thống rồi bấm "Replay" để xử lý lại.
 */
export type ErrorClassification = 'TRANSIENT' | 'PERMANENT';

export interface RetryPolicyConfig {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxAttempts: number;
  readonly backoffFactor: number;
  readonly enableJitter: boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryPolicyConfig = {
  initialDelayMs: 100,
  maxDelayMs: 5000,
  maxAttempts: 3,
  backoffFactor: 2,
  enableJitter: false, // Để deterministic trong unit tests
};

export interface DeadLetterRecord<T = unknown> {
  readonly id: string;
  readonly originalMessageId: string;
  readonly originalTopic: string;
  readonly payload: T;
  readonly failureReason: string;
  readonly errorClassification: ErrorClassification;
  readonly retryAttempts: number;
  readonly deadLetteredAt: Date;
  status: 'PENDING_REVIEW' | 'REPLAYED' | 'DISCARDED';
  replayedAt?: Date;
}

/**
 * -------------------------------------------------------------
 * 1. Phân loại Lỗi: Transient vs Permanent Error
 * -------------------------------------------------------------
 */
export function classifyError(error: unknown): ErrorClassification {
  if (!error) return 'PERMANENT';

  const err = error as Record<string, any>;
  const msg = (err.message || '').toUpperCase();
  const code = (err.code || '').toUpperCase();
  const status = typeof err.statusCode === 'number' ? err.statusCode : typeof err.status === 'number' ? err.status : 0;

  // 1. Permanent Errors: Cấm retry tuyệt đối
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 409 ||
    status === 422 ||
    code === 'INVALID_INPUT' ||
    code === 'VALIDATION_ERROR' ||
    code === 'ORDER_VALIDATION_ERROR' ||
    code === 'CONTRACT_VALIDATION_ERROR' ||
    code === 'UNAUTHORIZED' ||
    code === 'FORBIDDEN' ||
    code === 'CONFLICT' ||
    msg.includes('BAD_REQUEST') ||
    msg.includes('INVALID') ||
    msg.includes('POISON_PILL') ||
    msg.includes('SYNTAX_ERROR') ||
    msg.includes('JSON_PARSE_ERROR')
  ) {
    return 'PERMANENT';
  }

  // 2. Transient Errors: Lỗi mạng tạm thời, quá tải, timeout
  if (
    status === 503 ||
    status === 504 ||
    status === 429 ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'BUS_CLOSED' ||
    msg.includes('TIMEOUT') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('NETWORK') ||
    msg.includes('CONNECTION')
  ) {
    return 'TRANSIENT';
  }

  // Mặc định lỗi 500 thông thường có thể là transient nếu không xác định
  if (status >= 500) {
    return 'TRANSIENT';
  }

  return 'PERMANENT';
}

/**
 * -------------------------------------------------------------
 * 2. Tính toán Exponential Backoff Delay
 * -------------------------------------------------------------
 */
export function calculateBackoff(
  attempt: number,
  config: RetryPolicyConfig = DEFAULT_RETRY_CONFIG
): number {
  if (attempt < 0) return config.initialDelayMs;
  const rawDelay = config.initialDelayMs * Math.pow(config.backoffFactor, attempt);
  const boundedDelay = Math.min(rawDelay, config.maxDelayMs);

  if (config.enableJitter) {
    // Full jitter ngẫu nhiên từ 0 đến boundedDelay
    return Math.floor(Math.random() * boundedDelay);
  }

  return boundedDelay;
}

/**
 * -------------------------------------------------------------
 * 3. Dead-Letter Queue Store & Manager
 * -------------------------------------------------------------
 */
export class DeadLetterQueueStore {
  private readonly records = new Map<string, DeadLetterRecord<any>>();

  public addRecord(record: DeadLetterRecord<any>): void {
    this.records.set(record.id, { ...record });
  }

  public getRecord(id: string): DeadLetterRecord<any> | undefined {
    return this.records.get(id);
  }

  public getAllRecords(): DeadLetterRecord<any>[] {
    return Array.from(this.records.values());
  }

  public getPendingRecords(): DeadLetterRecord<any>[] {
    return Array.from(this.records.values()).filter(r => r.status === 'PENDING_REVIEW');
  }

  public markReplayed(id: string): void {
    const record = this.records.get(id);
    if (record) {
      record.status = 'REPLAYED';
      record.replayedAt = new Date();
    }
  }

  public clear(): void {
    this.records.clear();
  }
}

/**
 * -------------------------------------------------------------
 * 4. Resilient Consumer Runner
 * -------------------------------------------------------------
 * Điều phối xử lý sự kiện có khả năng tự phục hồi:
 * - Tự động retry các Transient Errors theo Bounded Exponential Backoff
 * - Phát hiện Permanent Error $\to$ Đẩy thẳng vào DLQ mà không retry
 * - Quá số lần retry tối đa $\to$ Đẩy vào DLQ
 * - Cung cấp cơ chế Replay từ DLQ
 */
export class ResilientConsumerRunner {
  private readonly eventBus: IEventBus;
  private readonly dlqStore: DeadLetterQueueStore;
  private readonly config: RetryPolicyConfig;

  constructor(
    eventBus: IEventBus,
    dlqStore?: DeadLetterQueueStore,
    config: Partial<RetryPolicyConfig> = {}
  ) {
    this.eventBus = eventBus;
    this.dlqStore = dlqStore || new DeadLetterQueueStore();
    this.config = {
      ...DEFAULT_RETRY_CONFIG,
      ...config,
    };
  }

  public getDlqStore(): DeadLetterQueueStore {
    return this.dlqStore;
  }

  /**
   * Bọc một handler nghiệp vụ và thực thi với cơ chế Resilience Policy
   */
  public async executeWithResilience<T>(
    envelope: EventEnvelope<T>,
    topic: string,
    handler: (envelope: EventEnvelope<T>) => Promise<void>
  ): Promise<{ status: 'SUCCESS' | 'DEAD_LETTERED'; attempts: number; error?: string }> {
    let attempt = 0;

    while (attempt < this.config.maxAttempts) {
      try {
        await handler(envelope);
        return { status: 'SUCCESS', attempts: attempt + 1 };
      } catch (err: any) {
        attempt++;
        const classification = classifyError(err);

        // 1. Nếu là Permanent Error -> Ngắt retry ngay lập tức, chuyển vào DLQ
        if (classification === 'PERMANENT') {
          this.routeToDlq(envelope, topic, err.message, classification, attempt);
          return { status: 'DEAD_LETTERED', attempts: attempt, error: err.message };
        }

        // 2. Nếu là Transient Error nhưng đã hết lượt retry -> Chuyển vào DLQ
        if (attempt >= this.config.maxAttempts) {
          this.routeToDlq(envelope, topic, err.message, classification, attempt);
          return { status: 'DEAD_LETTERED', attempts: attempt, error: err.message };
        }

        // 3. Nếu là Transient Error và còn lượt -> Chờ theo backoff delay rồi thử lại
        const delay = calculateBackoff(attempt - 1, this.config);
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    return { status: 'DEAD_LETTERED', attempts: attempt };
  }

  /**
   * Đưa thông điệp vào Dead-Letter Queue
   */
  private routeToDlq<T>(
    envelope: EventEnvelope<T>,
    topic: string,
    reason: string,
    classification: ErrorClassification,
    attempts: number
  ): void {
    const dlqId = `dlq-${envelope.eventId}-${Date.now()}`;
    const record: DeadLetterRecord<T> = {
      id: dlqId,
      originalMessageId: envelope.eventId,
      originalTopic: topic,
      payload: envelope.payload,
      failureReason: reason,
      errorClassification: classification,
      retryAttempts: attempts,
      deadLetteredAt: new Date(),
      status: 'PENDING_REVIEW',
    };
    this.dlqStore.addRecord(record);
  }

  /**
   * Phát lại (Replay) một thông điệp từ DLQ trở lại EventBus
   */
  public async replayMessage(dlqId: string): Promise<boolean> {
    const record = this.dlqStore.getRecord(dlqId);
    if (!record || record.status !== 'PENDING_REVIEW') {
      return false;
    }

    // Đẩy lại sự kiện vào topic ban đầu
    await this.eventBus.publish(record.originalTopic, {
      eventId: record.originalMessageId,
      eventType: 'ReplayedEvent',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: record.payload,
      metadata: {
        source: 'dlq-replay-worker',
      },
    });

    this.dlqStore.markReplayed(dlqId);
    return true;
  }
}

