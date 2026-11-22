// apps/order-service/src/domain/events/order-created.ts
// Domain Events & Trạng thái đơn hàng (Clean Architecture)
// Bắt buộc tuân thủ tính Bất biến (Immutability - Deep Freeze). Không dùng parameter properties.

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REJECTED';

export const ORDER_STATUSES: readonly OrderStatus[] = Object.freeze([
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'REJECTED',
]);

export interface OrderItemSnapshot {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

export interface OrderCreatedPayload {
  readonly customerId: string;
  readonly items: readonly OrderItemSnapshot[];
  readonly totalAmount: number;
  readonly status: OrderStatus;
}

/**
 * Hàm hỗ trợ Deep Freeze để biến toàn bộ object thành bất biến hoàn toàn
 */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (
      val !== null &&
      (typeof val === 'object' || typeof val === 'function') &&
      !Object.isFrozen(val)
    ) {
      deepFreeze(val as object);
    }
  }
  return obj;
}

/**
 * Domain Event: OrderCreatedEvent
 * Đại diện cho sự kiện một đơn hàng mới đã được khởi tạo trong hệ thống.
 * Tính chất: Hoàn toàn bất biến (Immutable), mang schema version rõ ràng.
 */
export class OrderCreatedEvent {
  public readonly eventId: string;
  public readonly eventName: string;
  public readonly orderId: string;
  public readonly aggregateId: string;
  public readonly occurredOn: Date;
  public readonly version: number;
  public readonly payload: OrderCreatedPayload;

  constructor(
    orderId: string,
    payload: OrderCreatedPayload,
    version = 1,
    eventId?: string
  ) {
    if (!orderId || !orderId.trim()) {
      throw new Error('ORDER_ID_REQUIRED: Order ID không được để trống khi tạo Event');
    }
    this.eventId =
      eventId || `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.eventName = 'OrderCreated';
    this.orderId = orderId.trim();
    this.aggregateId = orderId.trim();
    this.occurredOn = new Date();
    this.version = version;
    this.payload = deepFreeze(JSON.parse(JSON.stringify(payload)));

    // Đóng băng toàn bộ instance sự kiện
    Object.freeze(this);
  }
}

// Alias để tương thích cả 2 chuẩn đặt tên
export const OrderCreatedDomainEvent = OrderCreatedEvent;

/**
 * Domain Service: OrderPricingService
 * Tính toán giá trị đơn hàng, chiết khấu theo chính sách mà không làm biến đổi trạng thái nội tại của Aggregate.
 */
export class OrderPricingService {
  /**
   * Tính toán tổng tiền đơn hàng kèm áp dụng chiết khấu khách hàng thân thiết
   */
  public calculateFinalAmount(
    items: readonly OrderItemSnapshot[],
    loyaltyDiscountPercent = 0
  ): number {
    const subtotal = items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );
    const discount = (subtotal * Math.max(0, Math.min(loyaltyDiscountPercent, 100))) / 100;
    return Math.max(0, subtotal - discount);
  }
}

