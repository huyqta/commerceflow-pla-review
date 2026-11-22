// apps/order-service/src/application/place-order.ts
// Order Lifecycle Coordination in Modular Monolith
// Tích hợp Catalog, Inventory và Payment nội bộ qua Interfaces / Ports & Adapters.
// Đáp ứng kịch bản R-01 (Happy Path), R-02 (Hết hàng -> REJECTED), R-03 (Payment lỗi -> CANCELLED + Compensation),
// và Invariants State Machine (CONFIRMED không thể CANCEL).
// Tương thích Node.js 24 LTS native type-stripping.

import { Order } from '../domain/order.aggregate.ts';
import type { OrderStatus } from '../domain/order.aggregate.ts';
import type { OrderRepository } from './ports/order-repository.ts';

export type { OrderStatus };

/**
 * -------------------------------------------------------------
 * 1. State Machine Definitions & Invariants
 * -------------------------------------------------------------
 */
export const ORDER_LIFECYCLE_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: Object.freeze(['CONFIRMED', 'CANCELLED', 'REJECTED'] as OrderStatus[]),
  CONFIRMED: Object.freeze([] as OrderStatus[]), // Trạng thái cuối: Không thể Cancel hay Reject
  CANCELLED: Object.freeze([] as OrderStatus[]), // Trạng thái cuối: Không thể Confirm
  REJECTED: Object.freeze([] as OrderStatus[]),  // Trạng thái cuối: Không thể Confirm
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ORDER_LIFECYCLE_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export class OrderLifecycleError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'ORDER_LIFECYCLE_ERROR') {
    super(message);
    this.name = 'OrderLifecycleError';
    this.code = code;
  }
}

/**
 * -------------------------------------------------------------
 * 2. Ports (Contracts tích hợp giữa các Bounded Contexts)
 * -------------------------------------------------------------
 */
export interface CatalogItemInfo {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly price: number;
  readonly currency: string;
}

export interface CatalogQueryPort {
  findProductByIdOrSku(identifier: string): Promise<CatalogItemInfo | null>;
}

export interface InventoryReservationPort {
  reserveStock(command: {
    orderId: string;
    items: Array<{ productId: string; quantity: number }>;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; reservationId?: string; reason?: string }>;

  releaseStock(command: {
    reservationId: string;
    orderId: string;
    reason?: string;
  }): Promise<{ success: boolean; released: boolean; reason?: string }>;
}

export interface PaymentPort {
  processPayment(command: {
    orderId: string;
    customerId: string;
    amount: number;
  }): Promise<{ success: boolean; transactionId?: string; error?: string }>;
}

/**
 * -------------------------------------------------------------
 * 3. In-Memory / Default Adapters for Modular Monolith
 * -------------------------------------------------------------
 */
export class InMemoryCatalogPortAdapter implements CatalogQueryPort {
  private readonly products = new Map<string, CatalogItemInfo>();

  constructor(initialProducts: CatalogItemInfo[] = []) {
    for (const p of initialProducts) {
      this.products.set(p.id, p);
      this.products.set(p.sku, p);
    }
  }

  public async findProductByIdOrSku(identifier: string): Promise<CatalogItemInfo | null> {
    const item = this.products.get(identifier);
    return item ? { ...item } : null;
  }
}

export class PaymentSimulatorPortAdapter implements PaymentPort {
  private simulateFailure: boolean;

  constructor(simulateFailure = false) {
    this.simulateFailure = simulateFailure;
  }

  public setSimulateFailure(fail: boolean): void {
    this.simulateFailure = fail;
  }

  public async processPayment(command: {
    orderId: string;
    customerId: string;
    amount: number;
  }): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    if (this.simulateFailure) {
      return {
        success: false,
        error: 'PAYMENT_SIMULATOR_FAILED: Thẻ tín dụng bị từ chối hoặc cổng thanh toán gián đoạn',
      };
    }
    return {
      success: true,
      transactionId: `tx-pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    };
  }
}

/**
 * -------------------------------------------------------------
 * 4. PlaceOrder Use Case (Application Orchestrator)
 * -------------------------------------------------------------
 * Phân định rõ ranh giới kiến trúc:
 * Use Case nắm giữ toàn bộ luồng nghiệp vụ điều phối (Saga Lifecycle),
 * Controller tuyệt đối không được nhúng logic này.
 */
export interface PlaceOrderItemInput {
  productId: string;
  quantity: number;
}

export interface PlaceOrderCommand {
  orderId?: string;
  customerId: string;
  items: PlaceOrderItemInput[];
  idempotencyKey?: string;
  simulatePaymentFail?: boolean;
}

export interface PlaceOrderResult {
  orderId: string;
  status: OrderStatus;
  totalAmount: number;
  itemCount: number;
  reservationId?: string;
  paymentTransactionId?: string;
  reason?: string;
}

export class PlaceOrderUseCase {
  private readonly orderRepository: OrderRepository;
  private readonly catalogPort: CatalogQueryPort;
  private readonly inventoryPort: InventoryReservationPort;
  private readonly paymentPort: PaymentPort;

  constructor(
    orderRepository: OrderRepository,
    catalogPort: CatalogQueryPort,
    inventoryPort: InventoryReservationPort,
    paymentPort: PaymentPort
  ) {
    this.orderRepository = orderRepository;
    this.catalogPort = catalogPort;
    this.inventoryPort = inventoryPort;
    this.paymentPort = paymentPort;
  }

  public async execute(command: PlaceOrderCommand): Promise<PlaceOrderResult> {
    // 1. Kiểm tra đầu vào
    if (!command.customerId || !command.customerId.trim()) {
      throw new OrderLifecycleError('CUSTOMER_ID_REQUIRED: Mã khách hàng không được để trống', 'VALIDATION_ERROR');
    }
    if (!Array.isArray(command.items) || command.items.length === 0) {
      throw new OrderLifecycleError('EMPTY_ITEMS: Đơn hàng phải có ít nhất một sản phẩm', 'VALIDATION_ERROR');
    }

    const orderId =
      command.orderId && command.orderId.trim()
        ? command.orderId.trim()
        : `ord-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // 2. Tra cứu giá và thông tin sản phẩm từ CatalogPort (Đảm bảo giá trung thực từ hệ thống)
    const orderItemsInput = [];
    for (const item of command.items) {
      const catalogItem = await this.catalogPort.findProductByIdOrSku(item.productId);
      if (!catalogItem) {
        throw new OrderLifecycleError(
          `PRODUCT_NOT_FOUND: Sản phẩm '${item.productId}' không tồn tại trong danh mục catalog`,
          'CATALOG_ERROR'
        );
      }
      orderItemsInput.push({
        productId: catalogItem.id,
        quantity: item.quantity,
        unitPrice: catalogItem.price,
        currency: catalogItem.currency,
      });
    }

    // 3. Khởi tạo Order Aggregate ở trạng thái ban đầu: PENDING
    const order = Order.create(orderId, command.customerId.trim(), orderItemsInput);
    await this.orderRepository.save(order);

    // 4. Kịch bản Giữ kho (Inventory Reservation)
    const reserveResult = await this.inventoryPort.reserveStock({
      orderId: order.id,
      items: command.items.map((it) => ({ productId: it.productId, quantity: it.quantity })),
      idempotencyKey: command.idempotencyKey,
    });

    if (!reserveResult.success) {
      // Kịch bản R-02: HẾT HÀNG
      // Chuyển trạng thái sang REJECTED, không tạo payment, tồn kho không âm
      order.reject(reserveResult.reason || 'OUT_OF_STOCK');
      await this.orderRepository.save(order);

      return {
        orderId: order.id,
        status: 'REJECTED',
        totalAmount: order.getTotalAmount(),
        itemCount: order.getItems().length,
        reason: reserveResult.reason || 'OUT_OF_STOCK',
      };
    }

    const reservationId = reserveResult.reservationId || '';

    // 5. Kịch bản Thanh toán (Payment Charging)
    const paymentResult = command.simulatePaymentFail
      ? {
          success: false,
          error: 'PAYMENT_SIMULATOR_FAILED: Thẻ tín dụng bị từ chối hoặc cổng thanh toán gián đoạn',
        }
      : await this.paymentPort.processPayment({
          orderId: order.id,
          customerId: order.customerId,
          amount: order.getTotalAmount(),
        });

    if (!paymentResult.success) {
      // Kịch bản R-03: THANH TOÁN LỖI -> SAGA COMPENSATION
      // A. Chuyển trạng thái Order sang CANCELLED
      order.cancel(paymentResult.error || 'PAYMENT_FAILED');
      await this.orderRepository.save(order);

      // B. Kích hoạt bồi hoàn: Release Inventory đã giữ
      await this.inventoryPort.releaseStock({
        reservationId,
        orderId: order.id,
        reason: 'PAYMENT_FAILED',
      });

      return {
        orderId: order.id,
        status: 'CANCELLED',
        totalAmount: order.getTotalAmount(),
        itemCount: order.getItems().length,
        reservationId,
        reason: paymentResult.error || 'PAYMENT_FAILED',
      };
    }

    // 6. Kịch bản R-01: HAPPY PATH (Đặt hàng thành công)
    // Cả giữ kho và thanh toán đều thành công -> Chuyển sang CONFIRMED
    order.confirm();
    await this.orderRepository.save(order);

    return {
      orderId: order.id,
      status: 'CONFIRMED',
      totalAmount: order.getTotalAmount(),
      itemCount: order.getItems().length,
      reservationId,
      paymentTransactionId: paymentResult.transactionId,
    };
  }
}

/**
 * -------------------------------------------------------------
 * 5. Presentation Layer: PlaceOrderController
 * -------------------------------------------------------------
 * Chứng minh nguyên lý: Controller "gầy" (Thin Controller).
 * Chỉ nhận HTTP body, gọi UseCase và ánh xạ HTTP status code.
 * Tuyệt đối không chứa logic điều phối state hay kết nối DB trực tiếp.
 */
export class PlaceOrderController {
  private readonly placeOrderUseCase: PlaceOrderUseCase;

  constructor(placeOrderUseCase: PlaceOrderUseCase) {
    this.placeOrderUseCase = placeOrderUseCase;
  }

  public async handlePlaceOrder(body: unknown): Promise<{ statusCode: number; data: PlaceOrderResult }> {
    if (!body || typeof body !== 'object') {
      return {
        statusCode: 400,
        data: {
          orderId: '',
          status: 'REJECTED',
          totalAmount: 0,
          itemCount: 0,
          reason: 'INVALID_REQUEST_BODY',
        },
      };
    }

    const cmd = body as PlaceOrderCommand;
    const result = await this.placeOrderUseCase.execute(cmd);

    // Ánh xạ Status Code theo trạng thái vòng đời
    let statusCode = 200;
    if (result.status === 'CONFIRMED') {
      statusCode = 201; // Created & Confirmed
    } else if (result.status === 'REJECTED') {
      statusCode = 422; // Unprocessable Entity (Hết hàng / Out of stock)
    } else if (result.status === 'CANCELLED') {
      statusCode = 402; // Payment Required / Failed
    }

    return {
      statusCode,
      data: result,
    };
  }
}
