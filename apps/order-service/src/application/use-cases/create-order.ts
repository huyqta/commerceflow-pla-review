// apps/order-service/src/application/use-cases/create-order.ts
// Use Cases, Commands, Queries và Unit of Work (Clean Architecture / Hexagonal Architecture)
// Tuân thủ CQRS: Phân tách rõ ràng giữa Command (ghi/thay đổi trạng thái) và Query (đọc/không gây side-effect).
// Quản lý Transaction Boundary qua Unit of Work, không bọc external HTTP trong SQL transaction.
// Tương thích Node.js native type stripping (không dùng parameter properties trong constructor).

import { Order } from '../../domain/order.aggregate.ts';
import type { OrderRepository } from '../ports/order-repository.ts';

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REJECTED';

/**
 * -------------------------------------------------------------
 * 1. Business Errors (Tường minh, có cấu trúc)
 * -------------------------------------------------------------
 */
export class ApplicationError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'APPLICATION_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class OrderValidationError extends ApplicationError {
  constructor(message: string) {
    super(message, 'ORDER_VALIDATION_ERROR');
  }
}

export class OrderAlreadyExistsError extends ApplicationError {
  constructor(message: string) {
    super(message, 'ORDER_ALREADY_EXISTS');
  }
}

export class OrderNotFoundError extends ApplicationError {
  constructor(message: string) {
    super(message, 'ORDER_NOT_FOUND');
  }
}

/**
 * ============================================================================
 * PATTERN: CQRS - COMMAND SIDE & DTO PATTERN (Command Query Responsibility Segregation)
 * ============================================================================
 * [Mục đích cho Junior Developer]:
 * - CQRS chia hệ thống làm 2 nửa độc lập:
 *   1. Command: Thao tác làm THAY ĐỔI dữ liệu (Create, Update, Delete). Không trả về dữ liệu lớn, chỉ trả status/id.
 *   2. Query: Thao tác ĐỌC dữ liệu (Read-only). Tuyệt đối không gây ra side-effect (không đổi status, không update DB).
 * - DTO (Data Transfer Object): Đối tượng thuần dữ liệu mang thông tin từ bên ngoài (Controller/API)
 *   vào Use Case, giúp che giấu cấu trúc nội bộ của Domain Entity.
 */
export interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  currency?: string;
}

export interface CreateOrderCommand {
  orderId?: string;
  customerId: string;
  items: CreateOrderItemInput[];
  correlationId?: string;
}

export interface CreateOrderResult {
  orderId: string;
  customerId: string;
  status: OrderStatus;
  totalAmount: number;
  itemCount: number;
  createdAt: Date;
}

/**
 * ============================================================================
 * PATTERN: CQRS - QUERY SIDE & READ MODEL (View DTO)
 * ============================================================================
 * [Mục đích cho Junior Developer]:
 * - Phía Query chỉ quan tâm đến việc dữ liệu được hiển thị trên UI như thế nào.
 * - `OrderViewDto` làm phẳng dữ liệu (phẳng hóa Money.amount, Quantity.value),
 *   tính sẵn `subtotal` để Frontend React render ngay mà không cần tính toán lại.
 * - Không cần tạo Aggregate Root phức tạp khi chỉ muốn đọc dữ liệu lên màn hình!
 */
export interface GetOrderByIdQuery {
  orderId: string;
}

export interface OrderLineItemView {
  productId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface OrderViewDto {
  id: string;
  customerId: string;
  status: OrderStatus;
  totalAmount: number;
  items: OrderLineItemView[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ============================================================================
 * PATTERN: UNIT OF WORK (Quản lý Ranh giới Giao dịch - Transaction Boundary)
 * ============================================================================
 * [Mục đích cho Junior Developer]:
 * - Khi tạo một đơn hàng, có nhiều thao tác phải xảy ra đồng thời:
 *   + Lưu đơn hàng vào bảng `orders`
 *   + Lưu từng item vào bảng `order_items`
 *   + Lưu event vào bảng `outbox_events`
 * - NẾU KHÔNG CÓ UNIT OF WORK: Nếu bước 1 và 2 thành công nhưng bước 3 lỗi mạng,
 *   dữ liệu sẽ bị lưu dở dang (Inconsistent Data) trong Database!
 * - Unit of Work đảm bảo nguyên tắc ACID "All or Nothing":
 *   Bọc toàn bộ thao tác trong 1 transaction. Nếu bất kỳ dòng nào ném lỗi,
 *   tự động ROLLBACK toàn bộ về trạng thái ban đầu như chưa có gì xảy ra.
 * - LƯU Ý SỐNG CÒN: Không bao giờ gọi HTTP API bên ngoài (như gọi sang Payment Gateway)
 *   bên trong Unit of Work SQL, vì nếu API ngoài bị chậm 10 giây, database connection
 *   sẽ bị giữ khóa (lock) suốt 10 giây, làm sập toàn bộ database connection pool!
 */
export interface UnitOfWork {
  startTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  execute<T>(work: () => Promise<T>): Promise<T>;
}

export class InMemoryUnitOfWork implements UnitOfWork {
  private inTransaction: boolean;
  public commitCount: number;
  public rollbackCount: number;

  constructor() {
    this.inTransaction = false;
    this.commitCount = 0;
    this.rollbackCount = 0;
  }

  public async startTransaction(): Promise<void> {
    if (this.inTransaction) {
      throw new Error('TRANSACTION_ALREADY_ACTIVE');
    }
    this.inTransaction = true;
  }

  public async commit(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('NO_ACTIVE_TRANSACTION_TO_COMMIT');
    }
    this.commitCount++;
    this.inTransaction = false;
  }

  public async rollback(): Promise<void> {
    if (!this.inTransaction) {
      return;
    }
    this.rollbackCount++;
    this.inTransaction = false;
  }

  public async execute<T>(work: () => Promise<T>): Promise<T> {
    await this.startTransaction();
    try {
      const result = await work();
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  public isInTransaction(): boolean {
    return this.inTransaction;
  }
}

/**
 * -------------------------------------------------------------
 * 5. Use Case: CreateOrderUseCase (Command Handler)
 * -------------------------------------------------------------
 */
export class CreateOrderUseCase {
  private readonly orderRepository: OrderRepository;
  private readonly unitOfWork?: UnitOfWork;

  constructor(orderRepository: OrderRepository, unitOfWork?: UnitOfWork) {
    if (!orderRepository) {
      throw new Error('ORDER_REPOSITORY_REQUIRED');
    }
    this.orderRepository = orderRepository;
    this.unitOfWork = unitOfWork;
  }

  public async execute(command: CreateOrderCommand): Promise<CreateOrderResult> {
    // 1. Kiểm tra tính hợp lệ của Command input
    if (!command) {
      throw new OrderValidationError('Command không được để trống');
    }
    if (!command.customerId || !command.customerId.trim()) {
      throw new OrderValidationError('CUSTOMER_ID_REQUIRED: Mã khách hàng không được để trống');
    }
    if (!Array.isArray(command.items) || command.items.length === 0) {
      throw new OrderValidationError('EMPTY_ORDER_ITEMS: Đơn hàng phải có ít nhất một sản phẩm');
    }

    const orderId =
      command.orderId && command.orderId.trim()
        ? command.orderId.trim()
        : `ord-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // 2. Kiểm tra trùng lặp mã đơn (Chống duplicate command)
    const exists = await this.orderRepository.exists(orderId);
    if (exists) {
      throw new OrderAlreadyExistsError(`ORDER_ALREADY_EXISTS: Đơn hàng với ID '${orderId}' đã tồn tại`);
    }

    // 3. Thực thi nghiệp vụ bên trong Transaction Boundary (Local Unit of Work)
    const transactionalWork = async (): Promise<CreateOrderResult> => {
      // Aggregate Root bảo vệ toàn vẹn các Invariants (Quantity > 0, Price >= 0)
      const order = Order.create(orderId, command.customerId.trim(), command.items);

      // Lưu trữ trạng thái thông qua Repository Port
      await this.orderRepository.save(order);

      return {
        orderId: order.id,
        customerId: order.customerId,
        status: order.getStatus(),
        totalAmount: order.getTotalAmount(),
        itemCount: order.getItems().length,
        createdAt: order.createdAt,
      };
    };

    if (this.unitOfWork) {
      return await this.unitOfWork.execute(transactionalWork);
    }
    return await transactionalWork();
  }
}

/**
 * -------------------------------------------------------------
 * 6. Use Case: GetOrderByIdQueryHandler (Query Handler - CQRS)
 * -------------------------------------------------------------
 * Nguyên tắc: Chỉ đọc dữ liệu, tuyệt đối không làm thay đổi trạng thái (Side-effect free).
 */
export class GetOrderByIdQueryHandler {
  private readonly orderRepository: OrderRepository;

  constructor(orderRepository: OrderRepository) {
    if (!orderRepository) {
      throw new Error('ORDER_REPOSITORY_REQUIRED');
    }
    this.orderRepository = orderRepository;
  }

  public async execute(query: GetOrderByIdQuery): Promise<OrderViewDto | null> {
    if (!query || !query.orderId || !query.orderId.trim()) {
      throw new OrderValidationError('ORDER_ID_REQUIRED: Mã đơn hàng không được để trống khi truy vấn');
    }

    const order = await this.orderRepository.findById(query.orderId.trim());
    if (!order) {
      return null;
    }

    return {
      id: order.id,
      customerId: order.customerId,
      status: order.getStatus(),
      totalAmount: order.getTotalAmount(),
      items: order.getItems().map((item) => ({
        productId: item.productId,
        quantity: item.quantity.value,
        unitPrice: item.unitPrice.amount,
        subtotal: item.getSubtotal(),
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
