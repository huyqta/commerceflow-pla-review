// apps/order-service/src/domain/order.aggregate.ts
// Domain thuần TypeScript (Clean Architecture): Không phụ thuộc NestJS, Prisma hay GCP SDK.
// Lưu ý: Node type-stripping không hỗ trợ parameter properties trong constructor.

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REJECTED';

export interface DomainEvent {
  readonly eventName: string;
  readonly occurredOn: Date;
  readonly aggregateId: string;
  readonly payload?: Record<string, unknown>;
}

export class OrderCreatedDomainEvent implements DomainEvent {
  public readonly eventName = 'OrderCreatedDomainEvent';
  public readonly occurredOn: Date;
  public readonly aggregateId: string;
  public readonly payload: { customerId: string; totalAmount: number; itemCount: number };

  constructor(
    aggregateId: string,
    payload: { customerId: string; totalAmount: number; itemCount: number }
  ) {
    this.aggregateId = aggregateId;
    this.payload = payload;
    this.occurredOn = new Date();
  }
}

export class OrderConfirmedDomainEvent implements DomainEvent {
  public readonly eventName = 'OrderConfirmedDomainEvent';
  public readonly occurredOn: Date;
  public readonly aggregateId: string;

  constructor(aggregateId: string) {
    this.aggregateId = aggregateId;
    this.occurredOn = new Date();
  }
}

export class OrderCancelledDomainEvent implements DomainEvent {
  public readonly eventName = 'OrderCancelledDomainEvent';
  public readonly occurredOn: Date;
  public readonly aggregateId: string;
  public readonly payload: { reason: string };

  constructor(aggregateId: string, payload: { reason: string }) {
    this.aggregateId = aggregateId;
    this.payload = payload;
    this.occurredOn = new Date();
  }
}

/**
 * Value Object: Quantity
 * Invariant: Phải là số nguyên dương (> 0).
 */
export class Quantity {
  public readonly value: number;

  constructor(value: number) {
    if (!Number.isInteger(value)) {
      throw new Error('INVALID_QUANTITY: QUANTITY_MUST_BE_INTEGER');
    }
    if (value <= 0) {
      throw new Error('INVALID_QUANTITY: QUANTITY_MUST_BE_POSITIVE');
    }
    this.value = value;
  }

  equals(other: Quantity): boolean {
    return this.value === other.value;
  }
}

/**
 * Value Object: Money
 * Invariant: Số tiền không âm, đơn vị tiền tệ hợp lệ.
 */
export class Money {
  public readonly amount: number;
  public readonly currency: string;

  constructor(amount: number, currency = 'VND') {
    if (amount < 0 || isNaN(amount)) {
      throw new Error('INVALID_MONEY_AMOUNT: Amount must be non-negative');
    }
    this.amount = amount;
    this.currency = currency.toUpperCase();
  }

  add(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new Error('CURRENCY_MISMATCH');
    }
    return new Money(this.amount + other.amount, this.currency);
  }

  multiply(multiplier: number): Money {
    return new Money(this.amount * multiplier, this.currency);
  }
}

/**
 * Entity: OrderLineItem
 * Thuộc sở hữu nội bộ của Order Aggregate.
 */
export class OrderLineItem {
  public readonly productId: string;
  public readonly quantity: Quantity;
  public readonly unitPrice: Money;

  constructor(productId: string, quantity: Quantity, unitPrice: Money) {
    if (!productId || !productId.trim()) {
      throw new Error('PRODUCT_ID_REQUIRED');
    }
    this.productId = productId.trim();
    this.quantity = quantity;
    this.unitPrice = unitPrice;
  }

  getSubtotal(): number {
    return this.unitPrice.amount * this.quantity.value;
  }
}

export interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  currency?: string;
}

/**
 * Aggregate Root: Order
 * Quản lý trạng thái và bảo vệ các business invariants của đơn hàng.
 */
export class Order {
  public readonly id: string;
  public readonly customerId: string;
  private items: OrderLineItem[];
  private status: OrderStatus;
  private domainEvents: DomainEvent[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(
    id: string,
    customerId: string,
    items: OrderLineItem[],
    status: OrderStatus
  ) {
    this.id = id;
    this.customerId = customerId;
    this.items = items;
    this.status = status;
    this.domainEvents = [];
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  /**
   * Factory method khởi tạo Order Aggregate mới
   */
  public static create(
    id: string,
    customerId: string,
    itemInputs: CreateOrderItemInput[]
  ): Order {
    if (!id || !id.trim()) {
      throw new Error('ORDER_ID_REQUIRED: Danh tính đơn hàng không được để trống');
    }
    if (!customerId || !customerId.trim()) {
      throw new Error('CUSTOMER_ID_REQUIRED: Mã khách hàng không được để trống');
    }
    if (!Array.isArray(itemInputs) || itemInputs.length === 0) {
      throw new Error('EMPTY_ORDER_ITEMS: Đơn hàng bắt buộc phải có ít nhất một sản phẩm');
    }

    // Invariant: Chống trùng lặp sản phẩm trong cùng một đơn hàng
    const seenProductIds = new Set<string>();
    for (const input of itemInputs) {
      const pId = (input.productId || '').trim();
      if (!pId) {
        throw new Error('PRODUCT_ID_REQUIRED: Mã sản phẩm không được để trống');
      }
      if (seenProductIds.has(pId)) {
        throw new Error(`DUPLICATE_ORDER_ITEM: Sản phẩm '${pId}' bị trùng lặp trong đơn hàng. Hãy gộp số lượng thay vì tạo nhiều dòng.`);
      }
      seenProductIds.add(pId);
    }

    const items = itemInputs.map((input) => {
      const qty = new Quantity(input.quantity);
      const price = new Money(input.unitPrice, input.currency || 'VND');
      return new OrderLineItem(input.productId, qty, price);
    });

    const order = new Order(id.trim(), customerId.trim(), items, 'PENDING');

    // Sinh Domain Event khi tạo đơn thành công
    order.addDomainEvent(
      new OrderCreatedDomainEvent(order.id, {
        customerId: order.customerId,
        totalAmount: order.getTotalAmount(),
        itemCount: items.length,
      })
    );

    return order;
  }

  /**
   * Khôi phục Aggregate từ dữ liệu lưu trữ (Persistence Reconstitution)
   * Không kích hoạt OrderCreatedDomainEvent vì đơn hàng đã tồn tại trong quá khứ.
   */
  public static reconstitute(
    id: string,
    customerId: string,
    itemInputs: CreateOrderItemInput[],
    status: OrderStatus,
    createdAt?: Date,
    updatedAt?: Date
  ): Order {
    if (!id || !id.trim()) {
      throw new Error('ORDER_ID_REQUIRED: Danh tính đơn hàng không được để trống');
    }
    if (!customerId || !customerId.trim()) {
      throw new Error('CUSTOMER_ID_REQUIRED: Mã khách hàng không được để trống');
    }
    const items = (itemInputs || []).map((input) => {
      const qty = new Quantity(input.quantity);
      const price = new Money(input.unitPrice, input.currency || 'VND');
      return new OrderLineItem(input.productId, qty, price);
    });

    const order = new Order(id.trim(), customerId.trim(), items, status);
    if (createdAt) {
      (order as { createdAt: Date }).createdAt = createdAt;
    }
    if (updatedAt) {
      order.updatedAt = updatedAt;
    }
    return order;
  }

  public getStatus(): OrderStatus {
    return this.status;
  }

  public getItems(): readonly OrderLineItem[] {
    return Object.freeze([...this.items]);
  }

  public getTotalAmount(): number {
    return this.items.reduce((total, item) => total + item.getSubtotal(), 0);
  }

  /**
   * Xác nhận đơn hàng (PENDING -> CONFIRMED)
   * Invariant: Không cho phép confirm từ CANCELLED hoặc REJECTED.
   */
  public confirm(): void {
    if (this.status === 'CANCELLED' || this.status === 'REJECTED') {
      throw new Error(`INVALID_TRANSITION: CANNOT_CONFIRM_CANCELLED_ORDER (Current: ${this.status})`);
    }
    if (this.status !== 'PENDING') {
      throw new Error(`INVALID_TRANSITION: Order is already in ${this.status} state`);
    }

    this.status = 'CONFIRMED';
    this.updatedAt = new Date();
    this.addDomainEvent(new OrderConfirmedDomainEvent(this.id));
  }

  /**
   * Hủy đơn hàng (PENDING -> CANCELLED)
   * Invariant: Không cho phép cancel đơn hàng đã CONFIRMED.
   */
  public cancel(reason = 'Customer requested'): void {
    if (this.status === 'CONFIRMED') {
      throw new Error('INVALID_TRANSITION: CANNOT_CANCEL_CONFIRMED_ORDER');
    }
    if (this.status === 'CANCELLED') {
      throw new Error('INVALID_TRANSITION: Order is already CANCELLED');
    }

    this.status = 'CANCELLED';
    this.updatedAt = new Date();
    this.addDomainEvent(new OrderCancelledDomainEvent(this.id, { reason }));
  }

  /**
   * Từ chối đơn hàng (PENDING -> REJECTED)
   * Áp dụng khi hết hàng (R-02) hoặc không thỏa mãn điều kiện tiên quyết.
   * Invariant: Không cho phép reject đơn hàng đã CONFIRMED hoặc CANCELLED.
   */
  public reject(reason = 'Out of stock'): void {
    if (this.status === 'CONFIRMED') {
      throw new Error('INVALID_TRANSITION: CANNOT_REJECT_CONFIRMED_ORDER');
    }
    if (this.status === 'CANCELLED') {
      throw new Error('INVALID_TRANSITION: CANNOT_REJECT_CANCELLED_ORDER');
    }
    if (this.status === 'REJECTED') {
      throw new Error('INVALID_TRANSITION: Order is already REJECTED');
    }

    this.status = 'REJECTED';
    this.updatedAt = new Date();
  }

  public getDomainEvents(): readonly DomainEvent[] {
    return Object.freeze([...this.domainEvents]);
  }

  public clearDomainEvents(): DomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents = [];
    return events;
  }

  private addDomainEvent(event: DomainEvent): void {
    this.domainEvents.push(event);
  }
}
