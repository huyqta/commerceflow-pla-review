// apps/order-service/src/application/order-saga.ts
// Saga Orchestrator, Compensation Flow, Eventual Consistency & Timeout Recovery
// Phục vụ Milestone M4 (CF-022 - Saga orchestration, compensation, eventual consistency)
// Hiện thực hóa đầy đủ các kịch bản:
// - R-01 (Happy Path: Đơn PENDING -> Reserve -> Pay -> CONFIRMED)
// - R-02 (Out of stock: Không đủ hàng -> REJECTED, không charge payment)
// - R-03 (Payment Failure / Timeout: Hủy đơn CANCELLED, Release stock bồi hoàn)
// - R-04 (Duplicate Delivery / Idempotent Saga step transitions)
// - R-05 (Eventual Consistency & Timeout Recovery khi Payment Gateway bị treo)
// Tương thích Node.js 24 LTS native type-stripping (không dùng parameter properties, dùng import type).

import type { IEventBus, EventEnvelope } from '../../../../packages/messaging/src/event-bus.ts';
import type {
  OrderCreatedPayloadV1,
  ChargePaymentCommand,
  PaymentProcessedPayload,
} from '../../../../packages/contracts/src/order.ts';

export type SagaStep =
  | 'INITIAL'
  | 'RESERVING_INVENTORY'
  | 'INVENTORY_RESERVED'
  | 'INVENTORY_FAILED'
  | 'CHARGING_PAYMENT'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_TIMED_OUT'
  | 'COMPENSATING_INVENTORY'
  | 'COMPENSATED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED';

export interface SagaState {
  readonly sagaId: string;
  readonly orderId: string;
  readonly customerId: string;
  readonly items: { productId: string; quantity: number }[];
  readonly totalAmount: number;
  readonly currency: string;
  currentStep: SagaStep;
  orderStatus: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REJECTED';
  stockReserved: boolean;
  paymentCharged: boolean;
  compensationCount: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryClient {
  reserve(orderId: string, items: { productId: string; quantity: number }[]): Promise<{ success: boolean; reason?: string }>;
  release(orderId: string, reason: string): Promise<{ success: boolean }>;
}

export interface PaymentClient {
  charge(command: ChargePaymentCommand): Promise<{ status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT'; transactionId?: string; reason?: string }>;
}

export class SagaError extends Error {
  public readonly code: string;
  constructor(message: string, code = 'SAGA_ERROR') {
    super(message);
    this.name = 'SagaError';
    this.code = code;
  }
}

/**
 * -------------------------------------------------------------
 * OrderSagaOrchestrator
 * -------------------------------------------------------------
 * Bộ điều phối Saga Orchestration tập trung:
 * - Theo dõi State Machine của Saga instance
 * - Điều phối tuần tự các bước: Reserve Stock -> Charge Payment -> Confirm Order
 * - Tự động kích hoạt bù trừ (Compensation) khi thanh toán lỗi hoặc timeout
 * - Chống lặp bước (Idempotency step transitions)
 */
export class OrderSagaOrchestrator {
  private readonly inventoryClient: InventoryClient;
  private readonly paymentClient: PaymentClient;
  private readonly eventBus?: IEventBus;
  private readonly sagaInstances = new Map<string, SagaState>();
  private readonly processedEvents = new Set<string>(); // Chống xử lý duplicate broker messages

  constructor(
    inventoryClient: InventoryClient,
    paymentClient: PaymentClient,
    eventBus?: IEventBus
  ) {
    this.inventoryClient = inventoryClient;
    this.paymentClient = paymentClient;
    this.eventBus = eventBus;
  }

  public getSagaState(orderId: string): SagaState | undefined {
    return this.sagaInstances.get(orderId);
  }

  /**
   * Khởi chạy quy trình Saga khi nhận sự kiện OrderCreated (hoặc command submit order)
   */
  public async startSaga(order: {
    orderId: string;
    customerId: string;
    items: { productId: string; quantity: number }[];
    totalAmount: number;
    currency: string;
  }): Promise<SagaState> {
    if (this.sagaInstances.has(order.orderId)) {
      return this.sagaInstances.get(order.orderId)!;
    }

    const state: SagaState = {
      sagaId: `saga-${order.orderId}`,
      orderId: order.orderId,
      customerId: order.customerId,
      items: [...order.items],
      totalAmount: order.totalAmount,
      currency: order.currency,
      currentStep: 'INITIAL',
      orderStatus: 'PENDING',
      stockReserved: false,
      paymentCharged: false,
      compensationCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sagaInstances.set(order.orderId, state);

    // Bắt đầu bước 1: Reserve Inventory
    await this.executeReserveStep(state);
    return state;
  }

  /**
   * BƯỚC 1: Giữ tồn kho (Reserve Inventory)
   */
  private async executeReserveStep(state: SagaState): Promise<void> {
    state.currentStep = 'RESERVING_INVENTORY';
    state.updatedAt = new Date();

    const reserveRes = await this.inventoryClient.reserve(state.orderId, state.items);

    if (reserveRes.success) {
      state.stockReserved = true;
      state.currentStep = 'INVENTORY_RESERVED';
      state.updatedAt = new Date();

      // Bước 1 thành công -> Tiếp tục bước 2: Charge Payment
      await this.executePaymentStep(state);
    } else {
      // Kịch bản R-02: Hết hàng -> Từ chối đơn hàng, kết thúc Saga
      state.stockReserved = false;
      state.currentStep = 'REJECTED';
      state.orderStatus = 'REJECTED';
      state.lastError = reserveRes.reason || 'OUT_OF_STOCK';
      state.updatedAt = new Date();
    }
  }

  /**
   * BƯỚC 2: Thu tiền thanh toán (Charge Payment)
   */
  private async executePaymentStep(state: SagaState): Promise<void> {
    state.currentStep = 'CHARGING_PAYMENT';
    state.updatedAt = new Date();

    const paymentCmd: ChargePaymentCommand = {
      orderId: state.orderId,
      amount: state.totalAmount,
      currency: state.currency,
      idempotencyKey: `pay-${state.orderId}`,
    };

    const paymentRes = await this.paymentClient.charge(paymentCmd);

    if (paymentRes.status === 'SUCCEEDED') {
      // Kịch bản R-01: Thanh toán thành công -> Hoàn tất đơn hàng
      state.paymentCharged = true;
      state.currentStep = 'COMPLETED';
      state.orderStatus = 'CONFIRMED';
      state.updatedAt = new Date();
    } else if (paymentRes.status === 'TIMED_OUT') {
      // Thử thách độc lập: Gateway Timeout -> Kích hoạt bồi hoàn và chuyển sang PAYMENT_TIMED_OUT
      state.paymentCharged = false;
      state.currentStep = 'PAYMENT_TIMED_OUT';
      state.lastError = 'PAYMENT_GATEWAY_TIMEOUT';
      state.updatedAt = new Date();

      await this.executeCompensationStep(state, 'PAYMENT_TIMEOUT_COMPENSATION');
    } else {
      // Kịch bản R-03: Thanh toán thất bại -> Kích hoạt bồi hoàn kho
      state.paymentCharged = false;
      state.currentStep = 'PAYMENT_FAILED';
      state.lastError = paymentRes.reason || 'PAYMENT_DECLINED';
      state.updatedAt = new Date();

      await this.executeCompensationStep(state, 'PAYMENT_FAILED_COMPENSATION');
    }
  }

  /**
   * BƯỚC BỒI HOÀN: Giải phóng kho (Saga Compensation Step)
   * Chống hoàn kho 2 lần (Compensation Idempotency)
   */
  private async executeCompensationStep(state: SagaState, reason: string): Promise<void> {
    state.currentStep = 'COMPENSATING_INVENTORY';
    state.updatedAt = new Date();

    if (state.stockReserved) {
      await this.inventoryClient.release(state.orderId, reason);
      state.stockReserved = false;
      state.compensationCount += 1;
    }

    state.currentStep = 'CANCELLED';
    state.orderStatus = 'CANCELLED';
    state.updatedAt = new Date();
  }

  /**
   * Khôi phục sau sự cố Timeout (Timeout Recovery)
   * Kiểm tra các Saga bị treo ở bước CHARGING_PAYMENT quá thời gian timeout quy định
   */
  public async recoverStaleSagas(maxAgeMs = 5000): Promise<number> {
    let recoveredCount = 0;
    const now = Date.now();

    for (const state of this.sagaInstances.values()) {
      if (state.currentStep === 'CHARGING_PAYMENT' && state.orderStatus === 'PENDING') {
        const age = now - state.updatedAt.getTime();
        if (age >= maxAgeMs) {
          // Coi là thanh toán đã timeout -> Kích hoạt bồi hoàn an toàn
          state.currentStep = 'PAYMENT_TIMED_OUT';
          state.lastError = 'RECOVERED_FROM_STALE_TIMEOUT';
          await this.executeCompensationStep(state, 'STALE_SAGA_TIMEOUT_RECOVERY');
          recoveredCount++;
        }
      }
    }

    return recoveredCount;
  }

  /**
   * Xử lý Event đến từ Message Broker (Event-Driven Reactive Saga)
   * Chống trùng lặp tin nhắn (Idempotency)
   */
  public async handleEvent(envelope: EventEnvelope<any>): Promise<{ handled: boolean; reason?: string }> {
    if (this.processedEvents.has(envelope.eventId)) {
      return { handled: false, reason: 'DUPLICATE_EVENT_SKIPPED' };
    }
    this.processedEvents.add(envelope.eventId);

    const orderId = envelope.payload?.orderId;
    if (!orderId) {
      return { handled: false, reason: 'MISSING_ORDER_ID' };
    }

    const state = this.sagaInstances.get(orderId);
    if (!state) {
      return { handled: false, reason: 'SAGA_NOT_FOUND' };
    }

    // Chuyển đổi trạng thái theo sự kiện bất đồng bộ
    if (envelope.eventType === 'PaymentFailed' && state.orderStatus === 'PENDING') {
      await this.executeCompensationStep(state, 'ASYNC_PAYMENT_FAILED');
      return { handled: true };
    }

    if (envelope.eventType === 'PaymentSucceeded' && state.orderStatus === 'PENDING') {
      state.paymentCharged = true;
      state.currentStep = 'COMPLETED';
      state.orderStatus = 'CONFIRMED';
      state.updatedAt = new Date();
      return { handled: true };
    }

    return { handled: true };
  }
}

