import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OrderPageComponent,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from '../../apps/web/src/features/orders/OrderPage.ts';

describe('CF-026: Order Management and State Transitions UI', () => {
  it('should define accurate Vietnamese labels for all order states matching micro-lab', () => {
    assert.equal(ORDER_STATUS_LABELS.PENDING, 'Đang xử lý');
    assert.equal(ORDER_STATUS_LABELS.CONFIRMED, 'Đã xác nhận');
    assert.equal(ORDER_STATUS_LABELS.CANCELLED, 'Đã hủy');
    assert.equal(ORDER_STATUS_LABELS.REJECTED, 'Bị từ chối');
    assert.equal(ORDER_STATUS_LABELS.TIMEOUT, 'Quá thời gian xử lý');
  });

  it('Trade-off: should start with PENDING state upon submission, never early CONFIRMED', () => {
    const page = new OrderPageComponent();
    const items = [{ productId: 'p1', sku: 'SKU-1', quantity: 2, unitPrice: 100000 }];

    const order = page.submitOrder('CUST-100', items);
    assert.equal(order.status, 'PENDING');
    assert.equal(order.totalAmount, 200000);

    const state = page.getState();
    assert.equal(state.polling, true);
    assert.equal(state.pollAttempts, 0);

    const view = page.render();
    assert.equal(view.isPending, true);
    assert.equal(view.statusLabel, 'Đang xử lý');
    assert.ok(view.html.includes('badge-warning'));
    assert.ok(view.html.includes('Đang xử lý phân tán...'));
  });

  it('should transition to CONFIRMED when polling receives completed Saga status', async () => {
    const page = new OrderPageComponent();
    page.submitOrder('CUST-200', [{ productId: 'p2', sku: 'SKU-2', quantity: 1, unitPrice: 50000 }]);

    let pollCount = 0;
    const mockServerPoll = async (orderId: string): Promise<OrderStatus> => {
      pollCount++;
      if (pollCount < 2) return 'PENDING';
      return 'CONFIRMED';
    };

    // Step 1: Still pending
    const step1 = await page.pollNextStatus(mockServerPoll);
    assert.equal(step1.status, 'PENDING');
    assert.equal(step1.completed, false);
    assert.equal(page.getState().polling, true);

    // Step 2: Confirmed!
    const step2 = await page.pollNextStatus(mockServerPoll);
    assert.equal(step2.status, 'CONFIRMED');
    assert.equal(step2.completed, true);
    assert.equal(page.getState().polling, false);

    const view = page.render();
    assert.equal(view.isPending, false);
    assert.equal(view.statusLabel, 'Đã xác nhận');
    assert.ok(view.html.includes('badge-success'));
  });

  it('should transition to CANCELLED/REJECTED when Saga fails or runs out of stock', async () => {
    const page = new OrderPageComponent();
    page.submitOrder('CUST-300', [{ productId: 'p3', sku: 'SKU-3', quantity: 1, unitPrice: 70000 }]);

    const pollResult = await page.pollNextStatus(async () => 'CANCELLED');
    assert.equal(pollResult.status, 'CANCELLED');
    assert.equal(pollResult.completed, true);

    const view = page.render();
    assert.equal(view.statusLabel, 'Đã hủy');
    assert.ok(view.html.includes('badge-danger'));
  });

  it('Independent Challenge: should detect prolonged pending state and transition to TIMEOUT', async () => {
    // Configure maximum poll attempts = 3
    const page = new OrderPageComponent({ maxPollAttempts: 3 });
    page.submitOrder('CUST-HANGING', [{ productId: 'p-hang', sku: 'SKU-HANG', quantity: 1, unitPrice: 10000 }]);

    // Server is perpetually stuck in PENDING
    const stuckServer = async () => 'PENDING' as OrderStatus;

    await page.pollNextStatus(stuckServer); // attempt 1
    await page.pollNextStatus(stuckServer); // attempt 2
    await page.pollNextStatus(stuckServer); // attempt 3

    // attempt 4 exceeds maxPollAttempts (3)
    const timeoutResult = await page.pollNextStatus(stuckServer);
    assert.equal(timeoutResult.status, 'TIMEOUT');
    assert.equal(timeoutResult.timedOut, true);
    assert.equal(timeoutResult.completed, true);
    assert.equal(page.getState().polling, false);

    const view = page.render();
    assert.equal(view.statusLabel, 'Quá thời gian xử lý');
    assert.ok(view.html.includes('Saga response timeout exceeded max polling limit'));
  });

  it('Negative Case: should reject order submission with empty customerId or items', () => {
    const page = new OrderPageComponent();

    assert.throws(() => {
      page.submitOrder('', [{ productId: 'p1', sku: 's1', quantity: 1, unitPrice: 100 }]);
    }, /Customer ID is required/);

    assert.throws(() => {
      page.submitOrder('CUST-1', []);
    }, /Order items cannot be empty/);
  });
});

