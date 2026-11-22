import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  OrderSagaOrchestrator,
} from '../../apps/order-service/src/application/order-saga.ts';
import type {
  InventoryClient,
  PaymentClient,
  SagaState,
} from '../../apps/order-service/src/application/order-saga.ts';
import type { EventEnvelope } from '../../packages/messaging/src/event-bus.ts';

describe('1. Kịch bản R-01 & R-02: Đơn hàng Thành công & Hết hàng', () => {
  let inventoryClient: InventoryClient;
  let paymentClient: PaymentClient;
  let orchestrator: OrderSagaOrchestrator;

  beforeEach(() => {
    inventoryClient = {
      reserve: async () => ({ success: true }),
      release: async () => ({ success: true }),
    };
    paymentClient = {
      charge: async () => ({ status: 'SUCCEEDED', transactionId: 'TX-123' }),
    };
    orchestrator = new OrderSagaOrchestrator(inventoryClient, paymentClient);
  });

  it('R-01: Happy Path -> Giữ kho thành công, thu tiền thành công -> Saga COMPLETED, đơn CONFIRMED', async () => {
    const state = await orchestrator.startSaga({
      orderId: 'ORD-HAPPY',
      customerId: 'CUST-1',
      items: [{ productId: 'PROD-A', quantity: 2 }],
      totalAmount: 200,
      currency: 'VND',
    });

    assert.equal(state.orderStatus, 'CONFIRMED');
    assert.equal(state.currentStep, 'COMPLETED');
    assert.equal(state.stockReserved, true);
    assert.equal(state.paymentCharged, true);
    assert.equal(state.compensationCount, 0);
  });

  it('R-02: Out of Stock -> Không đủ hàng -> Saga REJECTED, đơn REJECTED, không gọi Payment', async () => {
    let paymentCalled = false;
    inventoryClient.reserve = async () => ({ success: false, reason: 'OUT_OF_STOCK' });
    paymentClient.charge = async () => {
      paymentCalled = true;
      return { status: 'SUCCEEDED' };
    };

    const state = await orchestrator.startSaga({
      orderId: 'ORD-OUT-OF-STOCK',
      customerId: 'CUST-1',
      items: [{ productId: 'PROD-B', quantity: 10 }],
      totalAmount: 1000,
      currency: 'VND',
    });

    assert.equal(state.orderStatus, 'REJECTED');
    assert.equal(state.currentStep, 'REJECTED');
    assert.equal(state.stockReserved, false);
    assert.equal(state.paymentCharged, false);
    assert.equal(paymentCalled, false, 'Tuyệt đối không được gọi thanh toán khi giữ hàng thất bại');
  });
});

describe('2. Kịch bản R-03: Thanh toán Lỗi & Saga Bồi hoàn (Compensation Flow)', () => {
  let inventoryClient: InventoryClient;
  let paymentClient: PaymentClient;
  let releaseCalled = false;
  let releaseCount = 0;

  beforeEach(() => {
    releaseCalled = false;
    releaseCount = 0;
    inventoryClient = {
      reserve: async () => ({ success: true }),
      release: async () => {
        releaseCalled = true;
        releaseCount++;
        return { success: true };
      },
    };
  });

  it('R-03: Payment thất bại -> Kích hoạt bồi hoàn giải phóng kho, đơn chuyển CANCELLED', async () => {
    paymentClient = {
      charge: async () => ({ status: 'FAILED', reason: 'CARD_DECLINED' }),
    };
    const orchestrator = new OrderSagaOrchestrator(inventoryClient, paymentClient);

    const state = await orchestrator.startSaga({
      orderId: 'ORD-PAY-FAILED',
      customerId: 'CUST-2',
      items: [{ productId: 'PROD-C', quantity: 1 }],
      totalAmount: 150,
      currency: 'VND',
    });

    assert.equal(state.orderStatus, 'CANCELLED');
    assert.equal(state.currentStep, 'CANCELLED');
    assert.equal(state.stockReserved, false);
    assert.equal(state.paymentCharged, false);
    assert.equal(releaseCalled, true, 'Bắt buộc phải gọi release tồn kho');
    assert.equal(releaseCount, 1);
    assert.equal(state.compensationCount, 1);
  });
});

describe('3. Thử thách độc lập: Xử lý Gateway Timeout & Khôi phục Saga (Timeout Recovery)', () => {
  it('Thử thách độc lập: Payment Gateway bị Timeout -> Saga chuyển PAYMENT_TIMED_OUT, kích hoạt bồi hoàn kho', async () => {
    let releaseReason = '';
    const inventoryClient: InventoryClient = {
      reserve: async () => ({ success: true }),
      release: async (_orderId, reason) => {
        releaseReason = reason;
        return { success: true };
      },
    };
    const paymentClient: PaymentClient = {
      charge: async () => ({ status: 'TIMED_OUT', reason: 'GATEWAY_TIMEOUT' }),
    };

    const orchestrator = new OrderSagaOrchestrator(inventoryClient, paymentClient);

    const state = await orchestrator.startSaga({
      orderId: 'ORD-TIMEOUT',
      customerId: 'CUST-3',
      items: [{ productId: 'PROD-D', quantity: 3 }],
      totalAmount: 450,
      currency: 'VND',
    });

    assert.equal(state.orderStatus, 'CANCELLED');
    assert.equal(state.currentStep, 'CANCELLED');
    assert.equal(state.stockReserved, false);
    assert.equal(state.compensationCount, 1);
    assert.equal(releaseReason, 'PAYMENT_TIMEOUT_COMPENSATION');
  });

  it('Stale Saga Recovery: Tự động phát hiện và bồi hoàn các Saga bị treo quá thời gian cho phép', async () => {
    const inventoryClient: InventoryClient = {
      reserve: async () => ({ success: true }),
      release: async () => ({ success: true }),
    };
    // Giả lập client thanh toán không bao giờ trả lời (treo request)
    const hangingPaymentClient: PaymentClient = {
      charge: async () => new Promise(() => {}), // Treo vô hạn
    };

    const orchestrator = new OrderSagaOrchestrator(inventoryClient, hangingPaymentClient);

    // Bắt đầu saga nhưng không await completion vì nó treo
    orchestrator.startSaga({
      orderId: 'ORD-HANGING',
      customerId: 'CUST-4',
      items: [{ productId: 'PROD-E', quantity: 1 }],
      totalAmount: 100,
      currency: 'VND',
    });

    // Chờ 10ms
    await new Promise((resolve) => setTimeout(resolve, 15));

    const state = orchestrator.getSagaState('ORD-HANGING')!;
    assert.equal(state.currentStep, 'CHARGING_PAYMENT');

    // Chạy cơ chế khôi phục stale saga với maxAgeMs = 10ms
    const recovered = await orchestrator.recoverStaleSagas(10);
    assert.equal(recovered, 1);

    // Kiểm tra state sau recovery
    assert.equal(state.orderStatus, 'CANCELLED');
    assert.equal(state.stockReserved, false);
    assert.equal(state.compensationCount, 1);
    assert.equal(state.lastError, 'RECOVERED_FROM_STALE_TIMEOUT');
  });
});

describe('4. Kịch bản R-04 & Reactive Event Idempotency', () => {
  it('Chống xử lý lặp lại event từ Broker (Idempotent Event Handling)', async () => {
    let releaseCalls = 0;
    const inventoryClient: InventoryClient = {
      reserve: async () => ({ success: true }),
      release: async () => {
        releaseCalls++;
        return { success: true };
      },
    };
    const hangingPayment: PaymentClient = {
      charge: async () => new Promise(() => {}),
    };

    const orchestrator = new OrderSagaOrchestrator(inventoryClient, hangingPayment);

    // Khởi chạy saga đang chờ
    orchestrator.startSaga({
      orderId: 'ORD-DUP-EVENT',
      customerId: 'CUST-5',
      items: [{ productId: 'PROD-F', quantity: 1 }],
      totalAmount: 200,
      currency: 'VND',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const paymentFailedEnvelope: EventEnvelope = {
      eventId: 'evt-failed-999',
      eventType: 'PaymentFailed',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { orderId: 'ORD-DUP-EVENT' },
      correlationId: 'corr-999',
      source: 'payment-service',
    };

    // Lần 1: Xử lý thành công
    const res1 = await orchestrator.handleEvent(paymentFailedEnvelope);
    assert.equal(res1.handled, true);
    assert.equal(releaseCalls, 1);

    // Lần 2: Broker gửi lặp cùng eventId -> Bỏ qua an toàn, không giải phóng kho lần 2
    const res2 = await orchestrator.handleEvent(paymentFailedEnvelope);
    assert.equal(res2.handled, false);
    assert.equal(res2.reason, 'DUPLICATE_EVENT_SKIPPED');
    assert.equal(releaseCalls, 1, 'Release không được gọi thêm lần 2');
  });
});

