// apps/inventory-service/src/application/reserve-stock.ts
// Inventory Reservation, Atomic Conditional Update & Anti-Overselling Logic
// Đáp ứng kịch bản R-01 (Giữ hàng thành công), R-02 (Hết hàng không trừ kho),
// R-03 (Bồi hoàn/Release stock không double compensation), R-04 (Chống duplicate delivery),
// và R-07 (Multi-item Atomic Reservation - All or Nothing).
// Hoàn toàn tương thích Node.js 24 LTS native type-stripping.

/**
 * -------------------------------------------------------------
 * 1. Domain Types & Error Classes
 * -------------------------------------------------------------
 */
export class InventoryError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'INVENTORY_ERROR') {
    super(message);
    this.name = 'InventoryError';
    this.code = code;
  }
}

export class OutOfStockError extends InventoryError {
  public readonly productId: string;
  public readonly requested: number;
  public readonly available: number;

  constructor(productId: string, requested: number, available: number) {
    super(
      `OUT_OF_STOCK: Sản phẩm '${productId}' không đủ tồn khả dụng (Yêu cầu: ${requested}, Hiện có: ${available})`,
      'OUT_OF_STOCK'
    );
    this.productId = productId;
    this.requested = requested;
    this.available = available;
  }
}

export class InvalidQuantityError extends InventoryError {
  constructor(message = 'INVALID_QUANTITY: Số lượng giữ hàng phải là số nguyên dương (> 0)') {
    super(message, 'INVALID_QUANTITY');
  }
}

export interface ReservationItem {
  readonly productId: string;
  readonly quantity: number;
}

export interface ReserveStockCommand {
  readonly orderId: string;
  readonly items: ReservationItem[];
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
}

export interface ReserveStockResult {
  readonly success: boolean;
  readonly reservationId: string;
  readonly orderId: string;
  readonly items: ReservationItem[];
  readonly reason?: string;
  readonly failedProductId?: string;
}

export interface ReleaseStockCommand {
  readonly reservationId: string;
  readonly orderId: string;
  readonly items?: ReservationItem[];
  readonly reason?: string;
}

export interface ReleaseStockResult {
  readonly success: boolean;
  readonly reservationId: string;
  readonly released: boolean;
  readonly reason?: string;
}

export interface InventoryStock {
  readonly productId: string;
  availableStock: number;
  reservedStock: number;
  totalStock: number;
  version: number;
}

export type ReservationStatus = 'RESERVED' | 'RELEASED' | 'CONFIRMED';

export interface ReservationRecord {
  readonly id: string;
  readonly orderId: string;
  readonly items: ReservationItem[];
  readonly idempotencyKey?: string;
  status: ReservationStatus;
  readonly createdAt: Date;
  updatedAt: Date;
}

/**
 * -------------------------------------------------------------
 * 2. Repository Interface (Port)
 * -------------------------------------------------------------
 */
export interface InventoryRepository {
  getStock(productId: string): Promise<InventoryStock | null>;
  setStock(stock: InventoryStock): Promise<void>;
  atomicReserveItem(productId: string, quantity: number): Promise<{ success: boolean; available: number }>;
  atomicReleaseItem(productId: string, quantity: number): Promise<{ success: boolean; available: number }>;
  saveReservation(record: ReservationRecord): Promise<void>;
  getReservation(reservationId: string): Promise<ReservationRecord | null>;
  getReservationByOrderId(orderId: string): Promise<ReservationRecord | null>;
  getReservationByIdempotencyKey(key: string): Promise<ReservationRecord | null>;
}

/**
 * -------------------------------------------------------------
 * 3. In-Memory Inventory Repository (Mô phỏng Atomic Conditional Update)
 * -------------------------------------------------------------
 * Mô phỏng câu lệnh SQL chuẩn PostgreSQL:
 * UPDATE inventory
 * SET available_stock = available_stock - :qty,
 *     reserved_stock = reserved_stock + :qty,
 *     version = version + 1
 * WHERE product_id = :productId AND available_stock >= :qty;
 */
export class InMemoryInventoryRepository implements InventoryRepository {
  private readonly stocks = new Map<string, InventoryStock>();
  private readonly reservations = new Map<string, ReservationRecord>();
  private readonly orderIndex = new Map<string, string>(); // orderId -> reservationId
  private readonly idempotencyIndex = new Map<string, string>(); // idempotencyKey -> reservationId

  constructor(initialStocks: InventoryStock[] = []) {
    for (const s of initialStocks) {
      this.stocks.set(s.productId, { ...s });
    }
  }

  public async getStock(productId: string): Promise<InventoryStock | null> {
    const s = this.stocks.get(productId);
    return s ? { ...s } : null;
  }

  public async setStock(stock: InventoryStock): Promise<void> {
    this.stocks.set(stock.productId, { ...stock });
  }

  /**
   * Atomic Conditional Update cho một item:
   * Kiểm tra điều kiện và trừ tồn kho ngay trong 1 bước nguyên tử.
   * TUYỆT ĐỐI KHÔNG để tồn kho âm (available >= quantity).
   */
  public async atomicReserveItem(
    productId: string,
    quantity: number
  ): Promise<{ success: boolean; available: number }> {
    const stock = this.stocks.get(productId);
    if (!stock) {
      return { success: false, available: 0 };
    }

    // Atomic Condition: available >= quantity
    if (stock.availableStock < quantity) {
      return { success: false, available: stock.availableStock };
    }

    // Cập nhật nguyên tử
    stock.availableStock -= quantity;
    stock.reservedStock += quantity;
    stock.version += 1;

    return { success: true, available: stock.availableStock };
  }

  /**
   * Atomic Release: Hoàn trả hàng đã giữ về lại kho khả dụng
   */
  public async atomicReleaseItem(
    productId: string,
    quantity: number
  ): Promise<{ success: boolean; available: number }> {
    const stock = this.stocks.get(productId);
    if (!stock) {
      return { success: false, available: 0 };
    }

    stock.availableStock += quantity;
    stock.reservedStock = Math.max(0, stock.reservedStock - quantity);
    stock.version += 1;

    return { success: true, available: stock.availableStock };
  }

  public async saveReservation(record: ReservationRecord): Promise<void> {
    this.reservations.set(record.id, { ...record });
    this.orderIndex.set(record.orderId, record.id);
    if (record.idempotencyKey) {
      this.idempotencyIndex.set(record.idempotencyKey, record.id);
    }
  }

  public async getReservation(reservationId: string): Promise<ReservationRecord | null> {
    const res = this.reservations.get(reservationId);
    return res ? { ...res } : null;
  }

  public async getReservationByOrderId(orderId: string): Promise<ReservationRecord | null> {
    const resId = this.orderIndex.get(orderId);
    if (!resId) return null;
    return this.getReservation(resId);
  }

  public async getReservationByIdempotencyKey(key: string): Promise<ReservationRecord | null> {
    const resId = this.idempotencyIndex.get(key);
    if (!resId) return null;
    return this.getReservation(resId);
  }

  /**
   * Phương thức minh họa lỗi thiết kế Read-then-write (Anti-pattern):
   * Tách rời bước đọc và bước ghi, dẫn đến Race condition và Overselling khi có concurrency.
   */
  public async flawedReadThenWriteReserve(
    productId: string,
    quantity: number,
    delayMs = 10
  ): Promise<{ success: boolean; available: number }> {
    const stock = this.stocks.get(productId);
    if (!stock) return { success: false, available: 0 };

    // 1. Bước ĐỌC (Read)
    const currentAvailable = stock.availableStock;
    if (currentAvailable < quantity) {
      return { success: false, available: currentAvailable };
    }

    // Giả lập độ trễ mạng hoặc context switch giữa Read và Write
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // 2. Bước GHI (Write không điều kiện - Flawed Write)
    // Nếu trong lúc chờ delay, có request khác đã trừ hàng, phép trừ này làm tồn kho bị ÂM!
    stock.availableStock -= quantity;
    stock.reservedStock += quantity;

    return { success: true, available: stock.availableStock };
  }
}

/**
 * -------------------------------------------------------------
 * 4. Application Use Case: ReserveStockUseCase
 * -------------------------------------------------------------
 * Xử lý giữ hàng an toàn:
 * - Bảo vệ R-04: Idempotent reservation (chống duplicate message từ Pub/Sub).
 * - Bảo vệ R-01 & R-02: Kiểm tra tồn kho khả dụng, không bao giờ để âm kho.
 * - Bảo vệ R-07: Multi-item Atomic Reservation (All-or-Nothing). Nếu 1 item thiếu hàng,
 *   tự động hoàn tác các item trước đó của đơn hàng và trả về thất bại.
 */
export class ReserveStockUseCase {
  private readonly repository: InventoryRepository;

  constructor(repository: InventoryRepository) {
    this.repository = repository;
  }

  public async execute(command: ReserveStockCommand): Promise<ReserveStockResult> {
    // 1. Validate Command đầu vào
    if (!command.orderId || !command.orderId.trim()) {
      throw new InventoryError('ORDER_ID_REQUIRED: Mã đơn hàng không được để trống', 'VALIDATION_ERROR');
    }
    if (!Array.isArray(command.items) || command.items.length === 0) {
      throw new InventoryError('EMPTY_RESERVATION_ITEMS: Danh sách sản phẩm giữ hàng không được rỗng', 'VALIDATION_ERROR');
    }

    for (const item of command.items) {
      if (!item.productId || !item.productId.trim()) {
        throw new InventoryError('PRODUCT_ID_REQUIRED: Mã sản phẩm không được để trống', 'VALIDATION_ERROR');
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new InvalidQuantityError(
          `INVALID_QUANTITY: Số lượng đặt của sản phẩm '${item.productId}' phải là số nguyên dương (> 0). Nhận được: ${item.quantity}`
        );
      }
    }

    // 2. Kiểm tra Idempotency (Bảo vệ kịch bản R-04 - Duplicate delivery)
    if (command.idempotencyKey) {
      const existingByIdem = await this.repository.getReservationByIdempotencyKey(command.idempotencyKey);
      if (existingByIdem) {
        return {
          success: existingByIdem.status === 'RESERVED',
          reservationId: existingByIdem.id,
          orderId: existingByIdem.orderId,
          items: existingByIdem.items,
        };
      }
    }

    const existingByOrder = await this.repository.getReservationByOrderId(command.orderId);
    if (existingByOrder) {
      return {
        success: existingByOrder.status === 'RESERVED',
        reservationId: existingByOrder.id,
        orderId: existingByOrder.orderId,
        items: existingByOrder.items,
      };
    }

    // 3. Multi-item Atomic Reservation (All-or-Nothing)
    const successfullyReserved: ReservationItem[] = [];

    for (const item of command.items) {
      // Thực hiện atomic conditional update
      const res = await this.repository.atomicReserveItem(item.productId, item.quantity);

      if (!res.success) {
        // HẾT HÀNG (Kịch bản R-02): Rollback/Bồi hoàn ngay các sản phẩm đã giữ trước đó
        for (const prev of successfullyReserved) {
          await this.repository.atomicReleaseItem(prev.productId, prev.quantity);
        }

        return {
          success: false,
          reservationId: '',
          orderId: command.orderId,
          items: command.items,
          reason: 'OUT_OF_STOCK',
          failedProductId: item.productId,
        };
      }

      successfullyReserved.push(item);
    }

    // 4. Lưu bản ghi Reservation thành công
    const reservationId = `res-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const record: ReservationRecord = {
      id: reservationId,
      orderId: command.orderId,
      items: command.items,
      idempotencyKey: command.idempotencyKey,
      status: 'RESERVED',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.repository.saveReservation(record);

    return {
      success: true,
      reservationId,
      orderId: command.orderId,
      items: command.items,
    };
  }
}

/**
 * -------------------------------------------------------------
 * 5. Application Use Case: ReleaseStockUseCase (Saga Compensation)
 * -------------------------------------------------------------
 * Xử lý hoàn kho khi thanh toán lỗi (Kịch bản R-03):
 * - Bảo đảm Idempotent Release: Không được hoàn kho hai lần (Chống double compensation).
 */
export class ReleaseStockUseCase {
  private readonly repository: InventoryRepository;

  constructor(repository: InventoryRepository) {
    this.repository = repository;
  }

  public async execute(command: ReleaseStockCommand): Promise<ReleaseStockResult> {
    if (!command.reservationId && !command.orderId) {
      throw new InventoryError('RESERVATION_IDENTIFIER_REQUIRED', 'VALIDATION_ERROR');
    }

    // Tìm bản ghi reservation
    let reservation: ReservationRecord | null = null;
    if (command.reservationId) {
      reservation = await this.repository.getReservation(command.reservationId);
    }
    if (!reservation && command.orderId) {
      reservation = await this.repository.getReservationByOrderId(command.orderId);
    }

    if (!reservation) {
      return {
        success: false,
        reservationId: command.reservationId || '',
        released: false,
        reason: 'RESERVATION_NOT_FOUND',
      };
    }

    // Invariant: Chống Double Compensation
    // Nếu đơn hàng đã được release trước đó, bỏ qua để đảm bảo Idempotency
    if (reservation.status === 'RELEASED') {
      return {
        success: true,
        reservationId: reservation.id,
        released: false,
        reason: 'ALREADY_RELEASED',
      };
    }

    // Hoàn trả số lượng hàng về kho khả dụng
    for (const item of reservation.items) {
      await this.repository.atomicReleaseItem(item.productId, item.quantity);
    }

    reservation.status = 'RELEASED';
    reservation.updatedAt = new Date();
    await this.repository.saveReservation(reservation);

    return {
      success: true,
      reservationId: reservation.id,
      released: true,
    };
  }
}

