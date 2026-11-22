// apps/web/src/features/orders/OrderPage.tsx
// Order Management, Saga State Transitions UI & Eventual Consistency Polling
// Phục vụ Milestone M5 (CF-026 — Order Management và state transitions UI)
// Cung cấp giao diện tạo đơn hàng, theo dõi vòng đời Saga và trạng thái Pending kéo dài (Timeout Recovery)

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REJECTED' | 'TIMEOUT';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'Đang xử lý',
  CONFIRMED: 'Đã xác nhận',
  CANCELLED: 'Đã hủy',
  REJECTED: 'Bị từ chối',
  TIMEOUT: 'Quá thời gian xử lý',
};

export interface OrderItem {
  readonly productId: string;
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

export interface OrderRecord {
  readonly id: string;
  readonly customerId: string;
  readonly items: readonly OrderItem[];
  readonly totalAmount: number;
  readonly currency: string;
  status: OrderStatus;
  readonly createdAt: Date;
  updatedAt: Date;
  statusHistory: Array<{ status: OrderStatus; timestamp: Date; reason?: string }>;
}

export interface OrderPageState {
  submitting: boolean;
  polling: boolean;
  pollAttempts: number;
  currentOrder: OrderRecord | null;
  error: string | null;
}

/**
 * Controller/Component điều phối trang Order Management & State Transitions
 */
export class OrderPageComponent {
  private state: OrderPageState;
  private readonly maxPollAttempts: number;
  private readonly pollIntervalMs: number;

  constructor(config?: { maxPollAttempts?: number; pollIntervalMs?: number }) {
    this.maxPollAttempts = config?.maxPollAttempts ?? 5;
    this.pollIntervalMs = config?.pollIntervalMs ?? 1000;
    this.state = {
      submitting: false,
      polling: false,
      pollAttempts: 0,
      currentOrder: null,
      error: null,
    };
  }

  public getState(): OrderPageState {
    return this.state;
  }

  /**
   * Khởi tạo quá trình tạo đơn hàng (Order Submission)
   * Trạng thái khởi tạo bắt buộc là PENDING (Không được báo CONFIRMED ngay lập tức để tránh Trade-off)
   */
  public submitOrder(customerId: string, items: OrderItem[]): OrderRecord {
    if (!customerId || customerId.trim() === '') {
      throw new Error('Customer ID is required');
    }
    if (!items || items.length === 0) {
      throw new Error('Order items cannot be empty');
    }

    const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const now = new Date();

    const order: OrderRecord = {
      id: `ord-${Date.now()}`,
      customerId,
      items: Object.freeze([...items]),
      totalAmount,
      currency: 'VND',
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
      statusHistory: [{ status: 'PENDING', timestamp: now, reason: 'Order submitted, awaiting Saga coordination' }],
    };

    this.state.currentOrder = order;
    this.state.submitting = false;
    this.state.polling = true;
    this.state.pollAttempts = 0;
    this.state.error = null;

    return order;
  }

  /**
   * Giả lập tiến trình Polling Eventual Consistency từ Order Service
   * Trả về kết quả polling hiện tại
   */
  public async pollNextStatus(
    fetchStatusFromServer: (orderId: string) => Promise<OrderStatus>
  ): Promise<{ status: OrderStatus; completed: boolean; timedOut: boolean }> {
    if (!this.state.currentOrder) {
      throw new Error('No active order to poll');
    }

    this.state.pollAttempts++;

    // Thử thách độc lập: Kiểm tra nếu thời gian pending kéo dài quá số lần thử tối đa
    if (this.state.pollAttempts > this.maxPollAttempts) {
      this.state.polling = false;
      this.state.currentOrder.status = 'TIMEOUT';
      this.state.currentOrder.updatedAt = new Date();
      this.state.currentOrder.statusHistory.push({
        status: 'TIMEOUT',
        timestamp: new Date(),
        reason: 'Saga response timeout exceeded max polling limit',
      });
      return { status: 'TIMEOUT', completed: true, timedOut: true };
    }

    const remoteStatus = await fetchStatusFromServer(this.state.currentOrder.id);
    this.state.currentOrder.status = remoteStatus;
    this.state.currentOrder.updatedAt = new Date();

    const isTerminal = remoteStatus === 'CONFIRMED' || remoteStatus === 'CANCELLED' || remoteStatus === 'REJECTED';

    if (isTerminal) {
      this.state.polling = false;
      this.state.currentOrder.statusHistory.push({
        status: remoteStatus,
        timestamp: new Date(),
        reason: `Saga completed with status ${remoteStatus}`,
      });
      return { status: remoteStatus, completed: true, timedOut: false };
    }

    // Vẫn đang ở trạng thái PENDING
    return { status: remoteStatus, completed: false, timedOut: false };
  }

  /**
   * Render giao diện ngữ nghĩa theo trạng thái đơn hàng hiện tại
   */
  public render(): {
    title: string;
    statusLabel: string;
    isPending: boolean;
    html: string;
  } {
    const order = this.state.currentOrder;

    if (!order) {
      return {
        title: 'Tạo đơn hàng mới',
        statusLabel: 'Chưa tạo',
        isPending: false,
        html: `
<div class="order-form-container" role="region" aria-label="Biểu mẫu đặt hàng">
  <h3>Nhập thông tin đơn hàng</h3>
  <form id="order-form">
    <div class="form-group">
      <label for="customer-id">Mã khách hàng:</label>
      <input type="text" id="customer-id" required placeholder="CUST-1234" />
    </div>
    <button type="submit" class="btn-primary">Xác nhận đặt hàng</button>
  </form>
</div>`.trim(),
      };
    }

    const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status;
    const isPending = order.status === 'PENDING';

    const statusClass =
      order.status === 'CONFIRMED'
        ? 'badge-success'
        : order.status === 'PENDING'
        ? 'badge-warning'
        : 'badge-danger';

    const historyItems = order.statusHistory
      .map(
        h =>
          `<li><strong>${ORDER_STATUS_LABELS[h.status] || h.status}</strong> (${h.timestamp.toLocaleTimeString(
            'vi-VN'
          )}): ${h.reason || ''}</li>`
      )
      .join('\n        ');

    return {
      title: `Đơn hàng #${order.id}`,
      statusLabel,
      isPending,
      html: `
<div class="order-details-container" role="region" aria-label="Chi tiết đơn hàng">
  <div class="order-header">
    <h3>Đơn hàng: <code>${order.id}</code></h3>
    <span class="badge ${statusClass}" role="status">${statusLabel}</span>
    ${isPending ? '<span class="spinner" aria-label="Đang xử lý phân tán...">⏳</span>' : ''}
  </div>

  <div class="order-summary">
    <p>Khách hàng: <strong>${order.customerId}</strong></p>
    <p>Tổng tiền: <strong>${order.totalAmount.toLocaleString('vi-VN')} ${order.currency}</strong></p>
  </div>

  <div class="order-saga-timeline">
    <h4>Tiến trình giao dịch phân tán (Saga Timeline):</h4>
    <ul class="timeline-list">
      ${historyItems}
    </ul>
  </div>
</div>`.trim(),
    };
  }
}

export default OrderPageComponent;

