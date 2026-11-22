// tests/order/order-lifecycle.test.ts
// Automated Test Suite cho Order Lifecycle trong Modular Monolith, State Machine Invariants,
// Tích hợp Catalog / Inventory / Payment qua Ports & Adapters (R-01, R-02, R-03, R-04).
// Chạy trực tiếp qua: node --test tests/order/order-lifecycle.test.ts

import assert from 'node:assert/strict';
import test, { describe, it, beforeEach } from 'node:test';

import { Order } from '../../apps/order-service/src/domain/order.aggregate.ts';
import { InMemoryOrderRepository } from '../../apps/order-service/src/application/ports/order-repository.ts';
import {
  PlaceOrderUseCase,
  PlaceOrderController,
  InMemoryCatalogPortAdapter,
  PaymentSimulatorPortAdapter,
  ORDER_LIFECYCLE_TRANSITIONS,
  canTransitionOrder,
} from '../../apps/order-service/src/application/place-order.ts';
import {
  ReserveStockUseCase,
  ReleaseStockUseCase,
  InMemoryInventoryRepository,
} from '../../apps/inventory-service/src/application/reserve-stock.ts';

describe('1. State Machine & Transition Invariants', () => {
  it('Bảng chuyển đổi trạng thái: PENDING có thể chuyển sang CONFIRMED, CANCELLED, REJECTED', () => {
    assert.deepEqual(ORDER_LIFECYCLE_TRANSITIONS.PENDING, ['CONFIRMED', 'CANCELLED', 'REJECTED']);
    assert.equal(canTransitionOrder('PENDING', 'CONFIRMED'), true);
    assert.equal(canTransitionOrder('PENDING', 'CANCELLED'), true);
    assert.equal(canTransitionOrder('PENDING', 'REJECTED'), true);
  });

  it('Thử thách độc lập: Ngăn cấm CANCEL đơn hàng đã CONFIRMED (State Machine Protection)', () => {
    assert.equal(canTransitionOrder('CONFIRMED', 'CANCELLED'), false, 'CONFIRMED không được phép chuyển sang CANCELLED');
    assert.equal(ORDER_LIFECYCLE_TRANSITIONS.CONFIRMED.length, 0, 'CONFIRMED là trạng thái kết thúc');

    const order = Order.create('ord-sm-test', 'cust-1', [{ productId: 'p1', quantity: 1, unitPrice: 100 }]);
    order.confirm();
    assert.equal(order.getStatus(), 'CONFIRMED');

    // Cố tình hủy đơn hàng đã duyệt -> Bắt buộc ném lỗi INVALID_TRANSITION
    assert.throws(
      () => order.cancel('Khách đòi hủy sau khi đã duyệt'),
      /INVALID_TRANSITION: CANNOT_CANCEL_CONFIRMED_ORDER/
    );
  });

  it('Ngăn cấm CONFIRM đơn hàng đã CANCELLED hoặc REJECTED', () => {
    assert.equal(canTransitionOrder('CANCELLED', 'CONFIRMED'), false);
    assert.equal(canTransitionOrder('REJECTED', 'CONFIRMED'), false);

    const cancelledOrder = Order.create('ord-cancel-test', 'cust-1', [{ productId: 'p1', quantity: 1, unitPrice: 100 }]);
    cancelledOrder.cancel('Đổi ý');
    assert.throws(() => cancelledOrder.confirm(), /INVALID_TRANSITION/);

    const rejectedOrder = Order.create('ord-reject-test', 'cust-1', [{ productId: 'p1', quantity: 1, unitPrice: 100 }]);
    rejectedOrder.reject('Hết hàng');
    assert.throws(() => rejectedOrder.confirm(), /INVALID_TRANSITION/);
  });
});

describe('2. Kịch bản R-01: Đơn hàng thành công (Happy Path)', () => {
  let orderRepo: InMemoryOrderRepository;
  let inventoryRepo: InMemoryInventoryRepository;
  let catalogPort: InMemoryCatalogPortAdapter;
  let paymentPort: PaymentSimulatorPortAdapter;
  let placeOrderUseCase: PlaceOrderUseCase;

  beforeEach(() => {
    orderRepo = new InMemoryOrderRepository();
    // Sản phẩm A có stock=5, giá 100
    catalogPort = new InMemoryCatalogPortAdapter([
      { id: 'PROD-A', sku: 'SKU-A', name: 'Sản phẩm A', price: 100, currency: 'VND' },
    ]);
    inventoryRepo = new InMemoryInventoryRepository([
      { productId: 'PROD-A', availableStock: 5, reservedStock: 0, totalStock: 5, version: 1 },
    ]);
    const reserveUseCase = new ReserveStockUseCase(inventoryRepo);
    const releaseUseCase = new ReleaseStockUseCase(inventoryRepo);

    // InventoryPort adapter nối với ReserveStockUseCase
    const inventoryPort = {
      reserveStock: (cmd: any) => reserveUseCase.execute(cmd),
      releaseStock: (cmd: any) => releaseUseCase.execute(cmd),
    };

    paymentPort = new PaymentSimulatorPortAdapter(false); // Thanh toán thành công

    placeOrderUseCase = new PlaceOrderUseCase(orderRepo, catalogPort, inventoryPort, paymentPort);
  });

  it('Given sản phẩm A có stock=5 và giá 100; When nhân viên đặt 2; Then đơn CONFIRMED, stock khả dụng còn 3', async () => {
    const result = await placeOrderUseCase.execute({
      orderId: 'ord-r01-happy',
      customerId: 'cust-r01',
      items: [{ productId: 'PROD-A', quantity: 2 }],
    });

    assert.equal(result.status, 'CONFIRMED');
    assert.equal(result.totalAmount, 200); // 2 * 100
    assert.ok(result.reservationId);
    assert.ok(result.paymentTransactionId);

    // Kiểm tra Order trong DB
    const savedOrder = await orderRepo.findById('ord-r01-happy');
    assert.equal(savedOrder?.getStatus(), 'CONFIRMED');

    // Kiểm tra tồn kho đã giảm chính xác
    const stock = await inventoryRepo.getStock('PROD-A');
    assert.equal(stock?.availableStock, 3, 'Tồn khả dụng phải giảm 2 (còn 3)');
    assert.equal(stock?.reservedStock, 2, 'Tồn giữ hàng là 2');
  });
});

describe('3. Kịch bản R-02: Hết hàng (Out of Stock Path)', () => {
  let orderRepo: InMemoryOrderRepository;
  let inventoryRepo: InMemoryInventoryRepository;
  let placeOrderUseCase: PlaceOrderUseCase;
  let paymentCallCount = 0;

  beforeEach(() => {
    orderRepo = new InMemoryOrderRepository();
    const catalogPort = new InMemoryCatalogPortAdapter([
      { id: 'PROD-B', sku: 'SKU-B', name: 'Sản phẩm B', price: 200, currency: 'VND' },
    ]);
    // Stock chỉ còn 1
    inventoryRepo = new InMemoryInventoryRepository([
      { productId: 'PROD-B', availableStock: 1, reservedStock: 0, totalStock: 1, version: 1 },
    ]);
    const reserveUseCase = new ReserveStockUseCase(inventoryRepo);
    const releaseUseCase = new ReleaseStockUseCase(inventoryRepo);

    paymentCallCount = 0;
    const paymentPort = {
      processPayment: async () => {
        paymentCallCount++;
        return { success: true };
      },
    };

    const inventoryPort = {
      reserveStock: (cmd: any) => reserveUseCase.execute(cmd),
      releaseStock: (cmd: any) => releaseUseCase.execute(cmd),
    };

    placeOrderUseCase = new PlaceOrderUseCase(orderRepo, catalogPort, inventoryPort, paymentPort);
  });

  it('Given stock=1; When đặt 2; Then request bị từ chối REJECTED, tồn kho không âm, không tạo payment', async () => {
    const result = await placeOrderUseCase.execute({
      orderId: 'ord-r02-out-stock',
      customerId: 'cust-r02',
      items: [{ productId: 'PROD-B', quantity: 2 }],
    });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reason, 'OUT_OF_STOCK');

    // Invariant 1: Không được gọi thanh toán
    assert.equal(paymentCallCount, 0, 'Tuyệt đối không được kích hoạt thanh toán khi giữ hàng thất bại');

    // Invariant 2: Tồn kho không bị âm
    const stock = await inventoryRepo.getStock('PROD-B');
    assert.equal(stock?.availableStock, 1, 'Tồn kho khả dụng giữ nguyên 1');
    assert.equal(stock?.reservedStock, 0, 'Tồn giữ hàng là 0');
  });
});

describe('4. Kịch bản R-03: Thanh toán lỗi & Saga Bồi hoàn (Compensation Path)', () => {
  let orderRepo: InMemoryOrderRepository;
  let inventoryRepo: InMemoryInventoryRepository;
  let placeOrderUseCase: PlaceOrderUseCase;

  beforeEach(() => {
    orderRepo = new InMemoryOrderRepository();
    const catalogPort = new InMemoryCatalogPortAdapter([
      { id: 'PROD-A', sku: 'SKU-A', name: 'Sản phẩm A', price: 100, currency: 'VND' },
    ]);
    inventoryRepo = new InMemoryInventoryRepository([
      { productId: 'PROD-A', availableStock: 5, reservedStock: 0, totalStock: 5, version: 1 },
    ]);
    const reserveUseCase = new ReserveStockUseCase(inventoryRepo);
    const releaseUseCase = new ReleaseStockUseCase(inventoryRepo);

    const inventoryPort = {
      reserveStock: (cmd: any) => reserveUseCase.execute(cmd),
      releaseStock: (cmd: any) => releaseUseCase.execute(cmd),
    };

    // Payment Simulator trả về failed
    const paymentPort = new PaymentSimulatorPortAdapter(true);

    placeOrderUseCase = new PlaceOrderUseCase(orderRepo, catalogPort, inventoryPort, paymentPort);
  });

  it('Given đã reserve 2; When payment simulator trả failed; Then order CANCELLED, inventory release 2', async () => {
    const result = await placeOrderUseCase.execute({
      orderId: 'ord-r03-pay-failed',
      customerId: 'cust-r03',
      items: [{ productId: 'PROD-A', quantity: 2 }],
    });

    // 1. Trạng thái đơn hàng phải là CANCELLED
    assert.equal(result.status, 'CANCELLED');
    assert.match(result.reason || '', /PAYMENT_SIMULATOR_FAILED/);

    // 2. Tồn kho khả dụng phải được bồi hoàn trở lại 5 (không bị giữ lại 2)
    const stock = await inventoryRepo.getStock('PROD-A');
    assert.equal(stock?.availableStock, 5, 'Saga Compensation phải hoàn trả tồn kho về 5');
    assert.equal(stock?.reservedStock, 0, 'Tồn giữ hàng phải về 0');
  });
});

describe('5. Trade-off: Fat Controller vs Thin Controller (Phân định ranh giới kiến trúc)', () => {
  it('PlaceOrderController chỉ là adapter chuyển đổi HTTP DTO, không chứa logic nghiệp vụ', async () => {
    const orderRepo = new InMemoryOrderRepository();
    const catalogPort = new InMemoryCatalogPortAdapter([
      { id: 'P1', sku: 'P1', name: 'Món 1', price: 50, currency: 'VND' },
    ]);
    const inventoryRepo = new InMemoryInventoryRepository([
      { productId: 'P1', availableStock: 10, reservedStock: 0, totalStock: 10, version: 1 },
    ]);
    const reserveUseCase = new ReserveStockUseCase(inventoryRepo);
    const releaseUseCase = new ReleaseStockUseCase(inventoryRepo);

    const useCase = new PlaceOrderUseCase(
      orderRepo,
      catalogPort,
      { reserveStock: (c: any) => reserveUseCase.execute(c), releaseStock: (c: any) => releaseUseCase.execute(c) },
      new PaymentSimulatorPortAdapter(false)
    );

    const controller = new PlaceOrderController(useCase);

    const httpResponse = await controller.handlePlaceOrder({
      customerId: 'cust-controller-test',
      items: [{ productId: 'P1', quantity: 2 }],
    });

    assert.equal(httpResponse.statusCode, 201);
    assert.equal(httpResponse.data.status, 'CONFIRMED');
    assert.equal(httpResponse.data.totalAmount, 100);
  });
});

