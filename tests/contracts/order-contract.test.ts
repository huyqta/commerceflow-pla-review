import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOrderCreatedEventV1,
  createOrderCreatedEventV2,
  validateOrderCreatedEventV1,
  validateOrderCreatedEventV2,
  validateChargePaymentCommand,
  validatePaymentProcessedEvent,
  ContractValidationError,
} from '../../packages/contracts/src/order.ts';
import type {
  OrderCreatedPayloadV1,
  OrderCreatedPayloadV2,
  ChargePaymentCommand,
  PaymentProcessedIntegrationEvent,
} from '../../packages/contracts/src/order.ts';

describe('1. Versioned Event Contracts (OrderCreated V1 & V2)', () => {
  const validV1Payload: OrderCreatedPayloadV1 = {
    orderId: 'ORD-2026-001',
    customerId: 'CUST-888',
    items: [
      { productId: 'PROD-1', quantity: 2, unitPrice: 150 },
      { productId: 'PROD-2', quantity: 1, unitPrice: 300 },
    ],
    totalAmount: 600,
    currency: 'VND',
    idempotencyKey: 'idemp-ord-001',
  };

  it('Tạo và xác thực OrderCreatedEvent V1 thành công với dữ liệu hợp lệ', () => {
    const event = createOrderCreatedEventV1(validV1Payload, { source: 'ordering-service' });

    assert.equal(event.eventType, 'OrderCreated');
    assert.equal(event.version, 1);
    assert.equal(event.payload.orderId, 'ORD-2026-001');
    assert.equal(event.payload.totalAmount, 600);
    assert.equal(event.metadata?.source, 'ordering-service');
    assert.doesNotThrow(() => validateOrderCreatedEventV1(event));
  });

  it('Thử thách độc lập: Thêm field optional vào V2 không làm gãy consumer đọc cấu trúc dữ liệu cốt lõi (Backward Compatibility)', () => {
    // V2 thêm các optional fields: customerEmail, shippingAddress
    const validV2Payload: OrderCreatedPayloadV2 = {
      ...validV1Payload,
      orderId: 'ORD-2026-002',
      customerEmail: 'customer@example.com',
      shippingAddress: {
        street: '123 Nguyen Hue',
        city: 'Ho Chi Minh',
        country: 'Vietnam',
      },
    };

    const eventV2 = createOrderCreatedEventV2(validV2Payload);
    assert.equal(eventV2.version, 2);
    assert.equal(eventV2.payload.customerEmail, 'customer@example.com');
    assert.doesNotThrow(() => validateOrderCreatedEventV2(eventV2));

    // Consumer cũ chỉ quan tâm các core fields của V1 (orderId, totalAmount, items)
    // Các fields mở rộng không gây lỗi logic cho consumer cũ
    const consumerOldLogic = (payload: { orderId: string; totalAmount: number; items: any[] }) => {
      assert.ok(payload.orderId);
      assert.ok(payload.totalAmount > 0);
      assert.equal(payload.items.length, 2);
      return true;
    };

    assert.equal(consumerOldLogic(eventV2.payload), true);
  });
});

describe('2. Negative & Boundary Test Cases cho Event Contracts', () => {
  it('Negative Case: Từ chối event khi thiếu hoặc sai kiểu trường bắt buộc (orderId rỗng)', () => {
    const invalidEvent = {
      eventId: 'evt-bad-1',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: {
        orderId: '', // Lỗi: orderId rỗng
        customerId: 'CUST-1',
        items: [{ productId: 'P1', quantity: 1, unitPrice: 100 }],
        totalAmount: 100,
        currency: 'VND',
      },
    };

    assert.throws(
      () => validateOrderCreatedEventV1(invalidEvent),
      (err) => {
        assert.ok(err instanceof ContractValidationError);
        assert.ok(err.errors.some(e => e.includes('orderId')));
        return true;
      }
    );
  });

  it('Negative Case: Từ chối event khi danh sách items rỗng', () => {
    const emptyItemsEvent = {
      eventId: 'evt-bad-2',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: {
        orderId: 'ORD-999',
        customerId: 'CUST-1',
        items: [], // Lỗi: items rỗng
        totalAmount: 100,
        currency: 'VND',
      },
    };

    assert.throws(
      () => validateOrderCreatedEventV1(emptyItemsEvent),
      (err) => {
        assert.ok(err instanceof ContractValidationError);
        assert.ok(err.errors.some(e => e.includes('items phải là mảng có ít nhất 1 phần tử')));
        return true;
      }
    );
  });

  it('Negative Case: Từ chối event khi quantity là số âm hoặc số thập phân', () => {
    const invalidQuantityEvent = {
      eventId: 'evt-bad-3',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: {
        orderId: 'ORD-999',
        customerId: 'CUST-1',
        items: [{ productId: 'P1', quantity: -2, unitPrice: 100 }], // Lỗi: quantity âm
        totalAmount: 100,
        currency: 'VND',
      },
    };

    assert.throws(
      () => validateOrderCreatedEventV1(invalidQuantityEvent),
      (err) => {
        assert.ok(err instanceof ContractValidationError);
        assert.ok(err.errors.some(e => e.includes('quantity phải là số nguyên dương')));
        return true;
      }
    );
  });

  it('Negative Case: Từ chối event khi version không khớp (Version Mismatch)', () => {
    const wrongVersionEvent = {
      eventId: 'evt-bad-4',
      eventType: 'OrderCreated',
      version: 99, // Lỗi: Không phải version 1
      timestamp: new Date().toISOString(),
      payload: {
        orderId: 'ORD-999',
        customerId: 'CUST-1',
        items: [{ productId: 'P1', quantity: 1, unitPrice: 100 }],
        totalAmount: 100,
        currency: 'VND',
      },
    };

    assert.throws(
      () => validateOrderCreatedEventV1(wrongVersionEvent),
      (err) => {
        assert.ok(err instanceof ContractValidationError);
        assert.ok(err.errors.some(e => e.includes('version phải là 1')));
        return true;
      }
    );
  });
});

describe('3. Payment Service Contracts (Commands & Events)', () => {
  it('Xác thực ChargePaymentCommand thành công với đầy đủ tham số', () => {
    const validCmd: ChargePaymentCommand = {
      orderId: 'ORD-555',
      amount: 450,
      currency: 'VND',
      idempotencyKey: 'charge-idemp-555',
      paymentMethod: 'MOCK_CARD',
    };

    assert.doesNotThrow(() => validateChargePaymentCommand(validCmd));
  });

  it('Negative Case: Từ chối ChargePaymentCommand khi amount <= 0 hoặc thiếu idempotencyKey', () => {
    const invalidCmd = {
      orderId: 'ORD-555',
      amount: -10, // Lỗi: amount âm
      currency: 'VND',
    };

    assert.throws(
      () => validateChargePaymentCommand(invalidCmd),
      (err) => {
        assert.ok(err instanceof ContractValidationError);
        assert.ok(err.errors.some(e => e.includes('amount phải là số dương')));
        assert.ok(err.errors.some(e => e.includes('Thiếu idempotencyKey')));
        return true;
      }
    );
  });

  it('Xác thực PaymentProcessedIntegrationEvent thành công', () => {
    const paymentEvent: PaymentProcessedIntegrationEvent = {
      eventId: 'evt-pay-01',
      eventType: 'PaymentProcessed',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: {
        transactionId: 'TXN-999',
        orderId: 'ORD-555',
        amount: 450,
        currency: 'VND',
        status: 'SUCCEEDED',
        processedAt: new Date().toISOString(),
      },
    };

    assert.doesNotThrow(() => validatePaymentProcessedEvent(paymentEvent));
  });

  it('Negative Case: Từ chối PaymentProcessedIntegrationEvent với status không hợp lệ', () => {
    const invalidStatusEvent = {
      eventId: 'evt-pay-02',
      eventType: 'PaymentProcessed',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: {
        transactionId: 'TXN-999',
        orderId: 'ORD-555',
        status: 'PENDING_UNKNOWN', // Lỗi: status không hợp lệ
      },
    };

    assert.throws(
      () => validatePaymentProcessedEvent(invalidStatusEvent),
      (err) => {
        assert.ok(err instanceof ContractValidationError);
        assert.ok(err.errors.some(e => e.includes('status phải là SUCCEEDED hoặc FAILED')));
        return true;
      }
    );
  });
});

