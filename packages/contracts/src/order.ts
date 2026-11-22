// packages/contracts/src/order.ts
// Versioned Integration Event Contracts, Commands & DTOs for Ordering & Payment Services
// Phục vụ Milestone M4 (CF-019 - Tách Ordering/Payment và hợp đồng API)
// Thiết kế theo nguyên tắc:
// 1. Versioned Event Schema (Hỗ trợ versioning v1, v2 tương thích ngược)
// 2. Pure Data Contracts (Chỉ chứa DTOs, interfaces và validation functions, KHÔNG chứa domain logic / entities)
// 3. Backward Compatibility (Thêm optional field không làm gãy consumer cũ)
// 4. Strict Validation (Fail-fast với invalid payload, thiếu required fields, hoặc version không được hỗ trợ)
// Tương thích Node.js 24 LTS native type-stripping (không dùng parameter properties, dùng import/export type).

/**
 * -------------------------------------------------------------
 * 1. Base Event Contract & Metadata Specification
 * -------------------------------------------------------------
 */
export interface EventMetadata {
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly userId?: string;
  readonly source: string;
}

export interface VersionedIntegrationEvent<TPayload = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly version: number;
  readonly timestamp: string;
  readonly payload: TPayload;
  readonly metadata?: EventMetadata;
}

/**
 * -------------------------------------------------------------
 * 2. Order Contracts (v1 & v2)
 * -------------------------------------------------------------
 */
export interface OrderItemContract {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

export type OrderStatusContract = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REJECTED';

// Payload v1: Phiên bản chuẩn ban đầu
export interface OrderCreatedPayloadV1 {
  readonly orderId: string;
  readonly customerId: string;
  readonly items: OrderItemContract[];
  readonly totalAmount: number;
  readonly currency: string;
  readonly idempotencyKey: string;
}

// Payload v2: Mở rộng tương thích ngược (Backward Compatible)
// Thêm các trường optional: shippingAddress, customerEmail, discountCode
export interface OrderCreatedPayloadV2 extends OrderCreatedPayloadV1 {
  readonly shippingAddress?: {
    readonly street: string;
    readonly city: string;
    readonly country: string;
  };
  readonly customerEmail?: string;
  readonly discountCode?: string;
}

export type OrderCreatedIntegrationEventV1 = VersionedIntegrationEvent<OrderCreatedPayloadV1>;
export type OrderCreatedIntegrationEventV2 = VersionedIntegrationEvent<OrderCreatedPayloadV2>;

/**
 * -------------------------------------------------------------
 * 3. Payment Contracts (Command & Event)
 * -------------------------------------------------------------
 */
export interface ChargePaymentCommand {
  readonly orderId: string;
  readonly amount: number;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly paymentMethod?: 'MOCK_CARD' | 'BANK_TRANSFER' | 'WALLET';
}

export interface PaymentProcessedPayload {
  readonly transactionId: string;
  readonly orderId: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: 'SUCCEEDED' | 'FAILED';
  readonly failureReason?: string;
  readonly processedAt: string;
}

export type PaymentProcessedIntegrationEvent = VersionedIntegrationEvent<PaymentProcessedPayload>;

/**
 * -------------------------------------------------------------
 * 4. Contract Validation Errors & Helper Functions
 * -------------------------------------------------------------
 */
export class ContractValidationError extends Error {
  public readonly errors: string[];

  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = 'ContractValidationError';
    this.errors = errors;
  }
}

/**
 * Validate OrderCreatedEvent V1
 */
export function validateOrderCreatedEventV1(
  event: unknown
): asserts event is OrderCreatedIntegrationEventV1 {
  const errors: string[] = [];

  if (!event || typeof event !== 'object') {
    throw new ContractValidationError('Event phải là một object', ['INVALID_EVENT_FORMAT']);
  }

  const e = event as Record<string, any>;

  if (!e.eventId || typeof e.eventId !== 'string') errors.push('Thiếu hoặc sai kiểu eventId');
  if (e.eventType !== 'OrderCreated') errors.push(`eventType phải là 'OrderCreated', nhận: ${e.eventType}`);
  if (e.version !== 1) errors.push(`version phải là 1, nhận: ${e.version}`);
  if (!e.timestamp || typeof e.timestamp !== 'string') errors.push('Thiếu timestamp ISO8601');

  if (!e.payload || typeof e.payload !== 'object') {
    errors.push('Thiếu payload');
  } else {
    const p = e.payload;
    if (!p.orderId || typeof p.orderId !== 'string') errors.push('Payload thiếu orderId');
    if (!p.customerId || typeof p.customerId !== 'string') errors.push('Payload thiếu customerId');
    if (typeof p.totalAmount !== 'number' || p.totalAmount <= 0) errors.push('totalAmount phải là số dương (> 0)');
    if (!p.currency || typeof p.currency !== 'string') errors.push('Payload thiếu currency');
    if (!Array.isArray(p.items) || p.items.length === 0) {
      errors.push('items phải là mảng có ít nhất 1 phần tử');
    } else {
      for (let i = 0; i < p.items.length; i++) {
        const item = p.items[i];
        if (!item.productId || typeof item.productId !== 'string') errors.push(`items[${i}] thiếu productId`);
        if (typeof item.quantity !== 'number' || item.quantity <= 0 || !Number.isInteger(item.quantity)) {
          errors.push(`items[${i}] quantity phải là số nguyên dương`);
        }
        if (typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
          errors.push(`items[${i}] unitPrice không được là số âm`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new ContractValidationError(`OrderCreatedEvent V1 không hợp lệ: ${errors.join('; ')}`, errors);
  }
}

/**
 * Validate OrderCreatedEvent V2
 * Hỗ trợ backward compatibility với consumer chỉ cần các trường V1
 */
export function validateOrderCreatedEventV2(
  event: unknown
): asserts event is OrderCreatedIntegrationEventV2 {
  const errors: string[] = [];

  if (!event || typeof event !== 'object') {
    throw new ContractValidationError('Event phải là một object', ['INVALID_EVENT_FORMAT']);
  }

  const e = event as Record<string, any>;

  if (!e.eventId || typeof e.eventId !== 'string') errors.push('Thiếu hoặc sai kiểu eventId');
  if (e.eventType !== 'OrderCreated') errors.push(`eventType phải là 'OrderCreated', nhận: ${e.eventType}`);
  if (e.version !== 2) errors.push(`version phải là 2, nhận: ${e.version}`);
  if (!e.timestamp || typeof e.timestamp !== 'string') errors.push('Thiếu timestamp ISO8601');

  if (!e.payload || typeof e.payload !== 'object') {
    errors.push('Thiếu payload');
  } else {
    const p = e.payload;
    if (!p.orderId || typeof p.orderId !== 'string') errors.push('Payload thiếu orderId');
    if (!p.customerId || typeof p.customerId !== 'string') errors.push('Payload thiếu customerId');
    if (typeof p.totalAmount !== 'number' || p.totalAmount <= 0) errors.push('totalAmount phải là số dương (> 0)');
    if (!p.currency || typeof p.currency !== 'string') errors.push('Payload thiếu currency');
    if (!Array.isArray(p.items) || p.items.length === 0) {
      errors.push('items phải là mảng có ít nhất 1 phần tử');
    }

    // Optional fields validation nếu có xuất hiện
    if (p.customerEmail !== undefined && typeof p.customerEmail !== 'string') {
      errors.push('customerEmail nếu có phải là kiểu string');
    }
    if (p.shippingAddress !== undefined) {
      if (typeof p.shippingAddress !== 'object' || !p.shippingAddress.street || !p.shippingAddress.city) {
        errors.push('shippingAddress không hợp lệ');
      }
    }
  }

  if (errors.length > 0) {
    throw new ContractValidationError(`OrderCreatedEvent V2 không hợp lệ: ${errors.join('; ')}`, errors);
  }
}

/**
 * Validate ChargePaymentCommand
 */
export function validateChargePaymentCommand(
  cmd: unknown
): asserts cmd is ChargePaymentCommand {
  const errors: string[] = [];

  if (!cmd || typeof cmd !== 'object') {
    throw new ContractValidationError('Command phải là một object', ['INVALID_COMMAND_FORMAT']);
  }

  const c = cmd as Record<string, any>;

  if (!c.orderId || typeof c.orderId !== 'string') errors.push('Thiếu orderId');
  if (typeof c.amount !== 'number' || c.amount <= 0) errors.push('amount phải là số dương (> 0)');
  if (!c.currency || typeof c.currency !== 'string') errors.push('Thiếu currency');
  if (!c.idempotencyKey || typeof c.idempotencyKey !== 'string') errors.push('Thiếu idempotencyKey');

  if (errors.length > 0) {
    throw new ContractValidationError(`ChargePaymentCommand không hợp lệ: ${errors.join('; ')}`, errors);
  }
}

/**
 * Validate PaymentProcessedIntegrationEvent
 */
export function validatePaymentProcessedEvent(
  event: unknown
): asserts event is PaymentProcessedIntegrationEvent {
  const errors: string[] = [];

  if (!event || typeof event !== 'object') {
    throw new ContractValidationError('Event phải là một object', ['INVALID_EVENT_FORMAT']);
  }

  const e = event as Record<string, any>;

  if (!e.eventId || typeof e.eventId !== 'string') errors.push('Thiếu eventId');
  if (e.eventType !== 'PaymentProcessed') errors.push(`eventType phải là 'PaymentProcessed', nhận: ${e.eventType}`);
  if (e.version !== 1) errors.push(`version phải là 1, nhận: ${e.version}`);

  if (!e.payload || typeof e.payload !== 'object') {
    errors.push('Thiếu payload');
  } else {
    const p = e.payload;
    if (!p.transactionId || typeof p.transactionId !== 'string') errors.push('Thiếu transactionId');
    if (!p.orderId || typeof p.orderId !== 'string') errors.push('Thiếu orderId');
    if (p.status !== 'SUCCEEDED' && p.status !== 'FAILED') errors.push('status phải là SUCCEEDED hoặc FAILED');
  }

  if (errors.length > 0) {
    throw new ContractValidationError(`PaymentProcessedEvent không hợp lệ: ${errors.join('; ')}`, errors);
  }
}

/**
 * Factory helper: Tạo OrderCreated Event V1 chuẩn
 */
export function createOrderCreatedEventV1(
  payload: OrderCreatedPayloadV1,
  metadata?: EventMetadata
): OrderCreatedIntegrationEventV1 {
  const event: OrderCreatedIntegrationEventV1 = {
    eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    eventType: 'OrderCreated',
    version: 1,
    timestamp: new Date().toISOString(),
    payload,
    metadata,
  };
  validateOrderCreatedEventV1(event);
  return event;
}

/**
 * Factory helper: Tạo OrderCreated Event V2 chuẩn (thêm optional fields)
 */
export function createOrderCreatedEventV2(
  payload: OrderCreatedPayloadV2,
  metadata?: EventMetadata
): OrderCreatedIntegrationEventV2 {
  const event: OrderCreatedIntegrationEventV2 = {
    eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    eventType: 'OrderCreated',
    version: 2,
    timestamp: new Date().toISOString(),
    payload,
    metadata,
  };
  validateOrderCreatedEventV2(event);
  return event;
}

