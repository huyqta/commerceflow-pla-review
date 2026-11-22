// apps/order-service/src/application/ports/order-repository.ts
// Ports & Adapters (Hexagonal Architecture) / Clean Architecture
// Luân chuyển luồng phụ thuộc theo Dependency Inversion Principle (DIP).
// Tầng Application định nghĩa Port (Interface), Infrastructure hoặc InMemory Adapter cài đặt Port.
// Domain và Port TUYỆT ĐỐI KHÔNG import Prisma hay các thư viện hạ tầng/ORM.

import { Order } from '../../domain/order.aggregate.ts';

/**
 * Port: OrderRepository
 * Hợp đồng trừu tượng định nghĩa các thao tác lưu trữ và truy vấn Order Aggregate.
 * Thuộc sở hữu của tầng Application / Domain (Driven Port / Outbound Port).
 */
export interface OrderRepository {
  /**
   * Lưu hoặc cập nhật Order Aggregate.
   */
  save(order: Order): Promise<void>;

  /**
   * Tìm đơn hàng theo mã định danh duy nhất (Aggregate ID).
   * Trả về Order nếu tìm thấy, hoặc null nếu không tồn tại.
   */
  findById(id: string): Promise<Order | null>;

  /**
   * Lấy danh sách các đơn hàng theo customerId.
   */
  findByCustomerId(customerId: string): Promise<Order[]>;

  /**
   * Kiểm tra sự tồn tại của đơn hàng theo id.
   */
  exists(id: string): Promise<boolean>;

  /**
   * Xóa đơn hàng theo id (nếu được phép bởi quy tắc nghiệp vụ).
   */
  delete(id: string): Promise<boolean>;
}

/**
 * In-Memory Adapter: InMemoryOrderRepository
 * Cài đặt OrderRepository dùng cấu trúc Map trong RAM.
 * Phục vụ Unit Testing, Local Micro-labs, hoặc Dev Mocking mà không cần cài đặt PostgreSQL/Prisma.
 */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly storage: Map<string, Order>;

  constructor(initialOrders: Order[] = []) {
    this.storage = new Map<string, Order>();
    for (const order of initialOrders) {
      if (order && order.id) {
        this.storage.set(order.id, order);
      }
    }
  }

  /**
   * Lưu hoặc ghi đè Order Aggregate vào bộ nhớ.
   */
  public async save(order: Order): Promise<void> {
    if (!order || typeof order !== 'object' || !('id' in order)) {
      throw new Error('INVALID_ORDER_ENTITY: Order entity không hợp lệ hoặc không có id');
    }
    if (!order.id || !order.id.trim()) {
      throw new Error('ORDER_ID_REQUIRED: Order ID không được để trống khi lưu vào repository');
    }

    // Lưu thực thể vào Map
    this.storage.set(order.id.trim(), order);
  }

  /**
   * Tìm Order theo id.
   */
  public async findById(id: string): Promise<Order | null> {
    if (!id || !id.trim()) {
      return null;
    }
    const order = this.storage.get(id.trim());
    return order ?? null;
  }

  /**
   * Lấy toàn bộ danh sách đơn hàng
   */
  public async findAll(): Promise<Order[]> {
    return Array.from(this.storage.values());
  }

  /**
   * Tìm tất cả Order của một khách hàng.
   */
  public async findByCustomerId(customerId: string): Promise<Order[]> {
    if (!customerId || !customerId.trim()) {
      return [];
    }
    const target = customerId.trim();
    const result: Order[] = [];
    for (const order of this.storage.values()) {
      if (order.customerId === target) {
        result.push(order);
      }
    }
    return result;
  }

  /**
   * Kiểm tra tồn tại theo id.
   */
  public async exists(id: string): Promise<boolean> {
    if (!id || !id.trim()) {
      return false;
    }
    return this.storage.has(id.trim());
  }

  /**
   * Xóa đơn hàng theo id.
   */
  public async delete(id: string): Promise<boolean> {
    if (!id || !id.trim()) {
      return false;
    }
    return this.storage.delete(id.trim());
  }

  /**
   * Tiện ích phục vụ testing: Xóa sạch bộ nhớ tạm.
   */
  public clear(): void {
    this.storage.clear();
  }

  /**
   * Tiện ích phục vụ testing: Đếm tổng số đơn hiện có trong RAM.
   */
  public count(): number {
    return this.storage.size;
  }

  /**
   * Tiện ích phục vụ testing: Lấy tất cả orders trong RAM.
   */
  public getAll(): Order[] {
    return Array.from(this.storage.values());
  }
}
