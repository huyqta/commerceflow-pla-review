// tests/inventory/inventory-reservation.test.ts
// Automated Test Suite cho Inventory Reservation, Atomic Conditional Update,
// Concurrency Race Conditions, Saga Compensation và Invariants (R-01, R-02, R-03, R-04, R-07).
// Chạy trực tiếp qua: node --test tests/inventory/inventory-reservation.test.ts

import assert from 'node:assert/strict';
import test, { describe, it, beforeEach } from 'node:test';

import {
  ReserveStockUseCase,
  ReleaseStockUseCase,
  InMemoryInventoryRepository,
  InventoryError,
  InvalidQuantityError,
} from '../../apps/inventory-service/src/application/reserve-stock.ts';

describe('1. Kịch bản R-01 & R-02: Đặt hàng thành công & Hết hàng', () => {
  let repo: InMemoryInventoryRepository;
  let reserveUseCase: ReserveStockUseCase;

  beforeEach(async () => {
    repo = new InMemoryInventoryRepository([
      { productId: 'PROD-A', availableStock: 5, reservedStock: 0, totalStock: 5, version: 1 },
      { productId: 'PROD-B', availableStock: 1, reservedStock: 0, totalStock: 1, version: 1 },
    ]);
    reserveUseCase = new ReserveStockUseCase(repo);
  });

  it('R-01: Sản phẩm có stock=5, đặt 2 -> Giữ thành công, availableStock giảm còn 3', async () => {
    const result = await reserveUseCase.execute({
      orderId: 'ord-r01',
      items: [{ productId: 'PROD-A', quantity: 2 }],
    });

    assert.equal(result.success, true);
    assert.ok(result.reservationId);

    const stock = await repo.getStock('PROD-A');
    assert.equal(stock?.availableStock, 3, 'Tồn khả dụng phải giảm 2');
    assert.equal(stock?.reservedStock, 2, 'Tồn giữ hàng phải tăng 2');
    assert.equal(stock?.totalStock, 5, 'Tổng tồn kho không đổi');
  });

  it('R-02: Sản phẩm có stock=1, đặt 2 -> Bị từ chối, tồn kho không bị âm', async () => {
    const result = await reserveUseCase.execute({
      orderId: 'ord-r02',
      items: [{ productId: 'PROD-B', quantity: 2 }],
    });

    assert.equal(result.success, false);
    assert.equal(result.reason, 'OUT_OF_STOCK');
    assert.equal(result.failedProductId, 'PROD-B');

    const stock = await repo.getStock('PROD-B');
    assert.equal(stock?.availableStock, 1, 'Tồn khả dụng phải giữ nguyên 1');
    assert.equal(stock?.reservedStock, 0, 'Không được tăng reservedStock khi thất bại');
  });

  it('Từ chối khi số lượng không hợp lệ (<= 0 hoặc số thập phân)', async () => {
    await assert.rejects(
      async () =>
        reserveUseCase.execute({
          orderId: 'ord-inv-qty',
          items: [{ productId: 'PROD-A', quantity: 0 }],
        }),
      (err) => {
        assert.ok(err instanceof InvalidQuantityError);
        return true;
      }
    );

    await assert.rejects(
      async () =>
        reserveUseCase.execute({
          orderId: 'ord-inv-qty-neg',
          items: [{ productId: 'PROD-A', quantity: -3 }],
        }),
      (err) => {
        assert.ok(err instanceof InvalidQuantityError);
        return true;
      }
    );
  });
});

describe('2. Kịch bản R-03: Saga Compensation & Chống Double Compensation', () => {
  let repo: InMemoryInventoryRepository;
  let reserveUseCase: ReserveStockUseCase;
  let releaseUseCase: ReleaseStockUseCase;

  beforeEach(async () => {
    repo = new InMemoryInventoryRepository([
      { productId: 'PROD-A', availableStock: 5, reservedStock: 0, totalStock: 5, version: 1 },
    ]);
    reserveUseCase = new ReserveStockUseCase(repo);
    releaseUseCase = new ReleaseStockUseCase(repo);
  });

  it('R-03: Đã reserve 2 -> Khi release thì tồn kho hoàn lại đúng 2', async () => {
    // 1. Giữ hàng
    const reserveRes = await reserveUseCase.execute({
      orderId: 'ord-r03',
      items: [{ productId: 'PROD-A', quantity: 2 }],
    });
    assert.equal(reserveRes.success, true);

    let stock = await repo.getStock('PROD-A');
    assert.equal(stock?.availableStock, 3);
    assert.equal(stock?.reservedStock, 2);

    // 2. Bồi hoàn (Payment Simulator trả về failed)
    const releaseRes = await releaseUseCase.execute({
      reservationId: reserveRes.reservationId,
      orderId: 'ord-r03',
      reason: 'PAYMENT_FAILED',
    });
    assert.equal(releaseRes.success, true);
    assert.equal(releaseRes.released, true);

    stock = await repo.getStock('PROD-A');
    assert.equal(stock?.availableStock, 5, 'Tồn khả dụng phải hoàn lại đủ 5');
    assert.equal(stock?.reservedStock, 0, 'Tồn giữ hàng phải về 0');
  });

  it('R-03: Chống Double Compensation: Không được hoàn kho lần 2 nếu đã release', async () => {
    const reserveRes = await reserveUseCase.execute({
      orderId: 'ord-r03-double',
      items: [{ productId: 'PROD-A', quantity: 2 }],
    });

    // Lần 1: Hoàn kho thành công
    const release1 = await releaseUseCase.execute({ reservationId: reserveRes.reservationId, orderId: 'ord-r03-double' });
    assert.equal(release1.released, true);

    // Lần 2: Gọi lặp lại bồi hoàn (Ví dụ message broker gửi lại lệnh release)
    const release2 = await releaseUseCase.execute({ reservationId: reserveRes.reservationId, orderId: 'ord-r03-double' });
    assert.equal(release2.success, true);
    assert.equal(release2.released, false, 'Không được giải phóng lần 2');
    assert.equal(release2.reason, 'ALREADY_RELEASED');

    // Khẳng định tồn kho không bị cộng dồn thành 7 (chống ảo kho)
    const stock = await repo.getStock('PROD-A');
    assert.equal(stock?.availableStock, 5, 'Tồn kho chỉ được đúng 5, không bị đội lên 7');
  });
});

describe('3. Kịch bản R-04: Idempotency (Duplicate Delivery Protection)', () => {
  let repo: InMemoryInventoryRepository;
  let reserveUseCase: ReserveStockUseCase;

  beforeEach(async () => {
    repo = new InMemoryInventoryRepository([
      { productId: 'PROD-A', availableStock: 5, reservedStock: 0, totalStock: 5, version: 1 },
    ]);
    reserveUseCase = new ReserveStockUseCase(repo);
  });

  it('R-04: Cùng 1 event/command gửi 2 lần -> Chỉ trừ kho đúng 1 lần (Idempotent Reservation)', async () => {
    const cmd = {
      orderId: 'ord-idem-01',
      idempotencyKey: 'event-msg-uuid-12345',
      items: [{ productId: 'PROD-A', quantity: 2 }],
    };

    // Gửi lần 1
    const res1 = await reserveUseCase.execute(cmd);
    assert.equal(res1.success, true);

    // Broker gửi lại lần 2 (Duplicate delivery)
    const res2 = await reserveUseCase.execute(cmd);
    assert.equal(res2.success, true);
    assert.equal(res2.reservationId, res1.reservationId, 'Phải trả về cùng reservationId');

    // Khẳng định chỉ trừ 2, không bị trừ thành 1
    const stock = await repo.getStock('PROD-A');
    assert.equal(stock?.availableStock, 3, 'Tồn kho chỉ giảm 2');
    assert.equal(stock?.reservedStock, 2);
  });
});

describe('4. Kịch bản R-07: Multi-item Atomic Reservation (All-or-Nothing)', () => {
  let repo: InMemoryInventoryRepository;
  let reserveUseCase: ReserveStockUseCase;

  beforeEach(async () => {
    repo = new InMemoryInventoryRepository([
      { productId: 'PROD-P1', availableStock: 5, reservedStock: 0, totalStock: 5, version: 1 },
      { productId: 'PROD-P2', availableStock: 1, reservedStock: 0, totalStock: 1, version: 1 },
    ]);
    reserveUseCase = new ReserveStockUseCase(repo);
  });

  it('R-07: Đơn hàng gồm 2 sản phẩm (P1 đủ 2, P2 thiếu 3) -> Rollback hoàn toàn P1, giữ nguyên tồn kho', async () => {
    const result = await reserveUseCase.execute({
      orderId: 'ord-multi-fail',
      items: [
        { productId: 'PROD-P1', quantity: 2 }, // Đủ hàng (5 >= 2)
        { productId: 'PROD-P2', quantity: 3 }, // Thiếu hàng (1 < 3) -> FAIL
      ],
    });

    assert.equal(result.success, false);
    assert.equal(result.reason, 'OUT_OF_STOCK');
    assert.equal(result.failedProductId, 'PROD-P2');

    // Khẳng định All-or-Nothing: P1 đã được hoàn trả lại ngay lập tức
    const stockP1 = await repo.getStock('PROD-P1');
    const stockP2 = await repo.getStock('PROD-P2');
    assert.equal(stockP1?.availableStock, 5, 'P1 phải được rollback về nguyên 5');
    assert.equal(stockP1?.reservedStock, 0, 'P1 không bị giữ');
    assert.equal(stockP2?.availableStock, 1, 'P2 giữ nguyên 1');
  });

  it('R-07: Cả 2 sản phẩm đều đủ hàng -> Giữ nguyên tử thành công cả 2', async () => {
    const result = await reserveUseCase.execute({
      orderId: 'ord-multi-success',
      items: [
        { productId: 'PROD-P1', quantity: 2 },
        { productId: 'PROD-P2', quantity: 1 },
      ],
    });

    assert.equal(result.success, true);
    const stockP1 = await repo.getStock('PROD-P1');
    const stockP2 = await repo.getStock('PROD-P2');
    assert.equal(stockP1?.availableStock, 3);
    assert.equal(stockP2?.availableStock, 0);
  });
});

describe('5. Thử thách độc lập: Hai đơn đồng thời giữ 1 món cuối (Race Condition & Chống Overselling)', () => {
  it('Concurrency Test: 2 transactions đồng thời đặt món cuối cùng -> Chính xác 1 thắng, 1 thua, tồn kho = 0', async () => {
    const repo = new InMemoryInventoryRepository([
      { productId: 'LAST-ITEM', availableStock: 1, reservedStock: 0, totalStock: 1, version: 1 },
    ]);
    const reserveUseCase = new ReserveStockUseCase(repo);

    // Kích hoạt đồng thời 2 đơn hàng cạnh tranh cùng 1 sản phẩm
    const [orderA, orderB] = await Promise.all([
      reserveUseCase.execute({
        orderId: 'ord-race-A',
        items: [{ productId: 'LAST-ITEM', quantity: 1 }],
      }),
      reserveUseCase.execute({
        orderId: 'ord-race-B',
        items: [{ productId: 'LAST-ITEM', quantity: 1 }],
      }),
    ]);

    // Kiểm tra kết quả cạnh tranh
    const successes = [orderA, orderB].filter((r) => r.success);
    const failures = [orderA, orderB].filter((r) => !r.success);

    assert.equal(successes.length, 1, 'Chỉ duy nhất 1 đơn hàng được giữ thành công');
    assert.equal(failures.length, 1, 'Đơn hàng còn lại bắt buộc phải nhận kết quả OUT_OF_STOCK');
    assert.equal(failures[0].reason, 'OUT_OF_STOCK');

    // Invariant: Tồn kho khả dụng giảm về 0, TUYỆT ĐỐI KHÔNG BỊ ÂM (-1)
    const finalStock = await repo.getStock('LAST-ITEM');
    assert.equal(finalStock?.availableStock, 0, 'Tồn kho khả dụng phải chính xác bằng 0');
    assert.equal(finalStock?.reservedStock, 1, 'Tồn giữ hàng phải bằng 1');
  });

  it('Trade-off Test: Minh họa lỗi Overselling nếu dùng Read-then-write không nguyên tử', async () => {
    const repo = new InMemoryInventoryRepository([
      { productId: 'VULNERABLE-ITEM', availableStock: 1, reservedStock: 0, totalStock: 1, version: 1 },
    ]);

    // 2 request đồng thời gọi hàm có bug Read-then-write
    const [resA, resB] = await Promise.all([
      repo.flawedReadThenWriteReserve('VULNERABLE-ITEM', 1, 15),
      repo.flawedReadThenWriteReserve('VULNERABLE-ITEM', 1, 15),
    ]);

    // Do cả 2 cùng đọc được available=1 trước khi write, cả 2 đều báo thành công!
    assert.equal(resA.success, true);
    assert.equal(resB.success, true);

    // Hậu quả: Bán khống (Overselling) - Tồn kho bị ÂM!
    const corruptedStock = await repo.getStock('VULNERABLE-ITEM');
    assert.ok(corruptedStock!.availableStock < 0, 'Chứng minh lỗi: Tồn kho bị âm do Read-then-write race condition');
    assert.equal(corruptedStock!.availableStock, -1);
  });
});

