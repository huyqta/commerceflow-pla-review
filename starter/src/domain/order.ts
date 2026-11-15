// Domain thuần TypeScript: không import NestJS, Prisma hoặc cloud SDK.
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export class Order {
  public readonly id: string;
  private status: OrderStatus;
  private constructor(id: string, status: OrderStatus) {
    // Type stripping trong Node 22 không hỗ trợ parameter properties.
    this.id = id;
    this.status = status;
  }
  static create(id: string): Order {
    if (!id.trim()) throw new Error('ORDER_ID_REQUIRED'); // Invariant: danh tính đơn không rỗng.
    return new Order(id, 'PENDING');
  }
  getStatus(): OrderStatus { return this.status; }
  confirm(): void {
    if (this.status !== 'PENDING') throw new Error('INVALID_TRANSITION');
    this.status = 'CONFIRMED';
  }
  cancel(): void {
    if (this.status !== 'PENDING') throw new Error('INVALID_TRANSITION');
    this.status = 'CANCELLED';
  }
  // TODO ở CF-006: thêm OrderItem/Quantity value object và invariant tổng số lượng.
}
