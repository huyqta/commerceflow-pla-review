# Evidence CF-014

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 7234928dc0b18c47716b26b1cc8d0cd1545ce1f5
- Commands / exit codes:
  - Command: `node labs/CF-014/demo.mjs`
  - Output: `MICRO_LAB_OK CF-014`
  - Exit code: `0`
  - Specialized Race Simulation: `node labs/CF-014/reservation-race.mjs`
  - Output: `RESERVATION_RACE_DEMO_OK`
  - Exit code: `0`
  - Automated Test Suite (Inventory Reservation & Concurrency): `node --test tests/inventory/inventory-reservation.test.ts`
  - Output: `ℹ tests 10 | ℹ suites 5 | ℹ pass 10 | ℹ fail 0 | ℹ duration_ms 156.3579`
  - Exit code: `0`
  - Catalog REST API Tests: `node --test tests/api/catalog-api.test.ts`
  - Output: `ℹ tests 12 | ℹ suites 4 | ℹ pass 12 | ℹ fail 0 | ℹ duration_ms 208.1509`
  - Exit code: `0`
  - Database Schema & ACID Tests: `node --test tests/database/order-schema.test.ts`
  - Output: `ℹ tests 12 | ℹ suites 3 | ℹ pass 12 | ℹ fail 0 | ℹ duration_ms 180.2292`
  - Exit code: `0`
  - Architecture Boundary Tests: `node --test tests/architecture/order-boundary.test.ts`
  - Output: `ℹ tests 13 | ℹ suites 3 | ℹ pass 13 | ℹ fail 0 | ℹ duration_ms 220.4623`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử 1 (Kịch bản R-02): Đặt hàng khi số lượng yêu cầu vượt quá tồn kho khả dụng (`stock=1`, `quantity=2`):
    - Lệnh: `node -e "import('./apps/inventory-service/src/application/reserve-stock.ts').then(async m => { const repo = new m.InMemoryInventoryRepository([{ productId: 'P1', availableStock: 1, reservedStock: 0, totalStock: 1, version: 1 }]); const uc = new m.ReserveStockUseCase(repo); const res = await uc.execute({ orderId: 'o1', items: [{ productId: 'P1', quantity: 2 }] }); if (!res.success && res.reason === 'OUT_OF_STOCK') { throw new Error('OUT_OF_STOCK: Sản phẩm P1 không đủ tồn khả dụng (Yêu cầu: 2, Hiện có: 1)'); } })"`
    - Observed Output: `Error: OUT_OF_STOCK: Sản phẩm P1 không đủ tồn khả dụng (Yêu cầu: 2, Hiện có: 1)` (Exit code 1).
  - Tình huống kiểm thử 2: Số lượng đặt không hợp lệ (`quantity = 0` hoặc `< 0`):
    - Lệnh: `node -e "import('./apps/inventory-service/src/application/reserve-stock.ts').then(m => { const repo = new m.InMemoryInventoryRepository(); const uc = new m.ReserveStockUseCase(repo); return uc.execute({ orderId: 'o1', items: [{ productId: 'P1', quantity: 0 }] }); })"`
    - Observed Output: `InvalidQuantityError [InventoryError]: INVALID_QUANTITY: Số lượng đặt của sản phẩm 'P1' phải là số nguyên dương (> 0). Nhận được: 0` (Exit code 1).
  - Tình huống kiểm thử 3 (Kịch bản R-07): Đơn hàng có 2 sản phẩm, 1 sản phẩm đủ nhưng sản phẩm kia thiếu -> Tự động Rollback nguyên tử All-or-Nothing:
    - Lệnh: `node -e "import('./apps/inventory-service/src/application/reserve-stock.ts').then(async m => { const repo = new m.InMemoryInventoryRepository([{ productId: 'P1', availableStock: 5, reservedStock: 0, totalStock: 5, version: 1 }, { productId: 'P2', availableStock: 1, reservedStock: 0, totalStock: 1, version: 1 }]); const uc = new m.ReserveStockUseCase(repo); const res = await uc.execute({ orderId: 'o1', items: [{ productId: 'P1', quantity: 2 }, { productId: 'P2', quantity: 3 }] }); const s1 = await repo.getStock('P1'); if (!res.success && s1.availableStock === 5) { console.log('PASS_MULTI_ITEM_ATOMIC_ROLLBACK'); } else { process.exit(1); } })"`
    - Observed Output: `PASS_MULTI_ITEM_ATOMIC_ROLLBACK` (Exit code 0).
  - Tình huống kiểm thử 4 (Thử thách độc lập): Minh họa lỗi Bán khống (Overselling) khi dùng Anti-pattern Read-then-write:
    - Lệnh: `node -e "import('./apps/inventory-service/src/application/reserve-stock.ts').then(async m => { const repo = new m.InMemoryInventoryRepository([{ productId: 'VULN', availableStock: 1, reservedStock: 0, totalStock: 1, version: 1 }]); await Promise.all([repo.flawedReadThenWriteReserve('VULN', 1, 10), repo.flawedReadThenWriteReserve('VULN', 1, 10)]); const s = await repo.getStock('VULN'); if (s.availableStock < 0) throw new Error('OVERSELLING_DETECTED: Tồn kho bị âm ' + s.availableStock + ' do race condition!'); })"`
    - Observed Output: `Error: OVERSELLING_DETECTED: Tồn kho bị âm -1 do race condition!` (Exit code 1).
  - Giải thích kết quả: Kiểm chứng thực tế sự khác biệt sống còn giữa cơ chế cập nhật điều kiện nguyên tử (Atomic Conditional Update) và mô hình Read-then-write truyền thống, đảm bảo tồn kho không bao giờ bị âm ngay cả khi có tải đồng thời cực lớn.

[ANSWER]
## 1. Trade-off: Rủi ro khi dùng Read-then-write thay vì Atomic Conditional Update (The Concurrency Race Condition Trap)

Trong các hệ thống thương mại điện tử (eCommerce) chịu tải đồng thời cao (High Concurrency / Flash Sale), mô hình kiểm tra tồn kho theo dạng **Read-then-write (Đọc rồi mới Ghi)** là nguyên nhân hàng đầu dẫn đến sự cố **Bán khống (Overselling / Negative Inventory)**:

### Cơ chế gây lỗi của Anti-pattern Read-then-write:
Giả sử sản phẩm chỉ còn duy nhất $1$ món tồn kho khả dụng (`available_stock = 1`). Hai khách hàng A và B cùng bấm mua đồng thời:
1. **Bước 1 (Thread A - Read):** `SELECT available_stock FROM inventory WHERE product_id = 'P1'` $\rightarrow$ Trả về `1`. Thread A kiểm tra `if (1 >= 1)` $\rightarrow$ Hợp lệ!
2. **Bước 2 (Thread B - Read):** Trong lúc Thread A chưa kịp ghi dữ liệu (do độ trễ mạng hoặc context switch), Thread B cũng chạy câu `SELECT` $\rightarrow$ Vẫn đọc được `available_stock = 1`. Thread B kiểm tra `if (1 >= 1)` $\rightarrow$ Hợp lệ!
3. **Bước 3 (Thread A - Write):** `UPDATE inventory SET available_stock = 0 ...` $\rightarrow$ Thành công.
4. **Bước 4 (Thread B - Write):** `UPDATE inventory SET available_stock = -1 ...` $\rightarrow$ Thành công!
$\rightarrow$ **Hậu quả thảm khốc:** Cả 2 đơn hàng đều được báo đặt hàng thành công, nhưng trong kho chỉ có 1 sản phẩm. Tồn kho bị âm (`-1`), doanh nghiệp phải đối mặt với khiếu nại, hủy đơn đền bù hoặc phạt vi phạm thương mại.

### Giải pháp kỹ thuật chuẩn hóa: Atomic Conditional Update
Thay vì tách rời bước đọc và bước ghi trong code ứng dụng, ta chuyển toàn bộ điều kiện kiểm tra vào **duy nhất một câu lệnh SQL nguyên tử** được thực thi trực tiếp tại Database Engine:
```sql
UPDATE inventory
SET available_stock = available_stock - :requested_qty,
    reserved_stock = reserved_stock + :requested_qty,
    version = version + 1
WHERE product_id = :productId 
  AND available_stock >= :requested_qty;
```
- **Nguyên lý hoạt động:** PostgreSQL sử dụng khóa mức dòng (Row-level Lock). Khi câu lệnh chạy, database sẽ khóa dòng sản phẩm đó và kiểm tra điều kiện `available_stock >= :requested_qty` ngay tại thời điểm ghi.
- **Xác định kết quả:**
  - Nếu `rows_affected == 1`: Giữ hàng thành công!
  - Nếu `rows_affected == 0`: Hết hàng ngay lập tức! (Không cần exception, không bị dirty read, tồn kho tuyệt đối không bao giờ âm).

---

## 2. Thử thách độc lập: Mô phỏng Hai đơn cùng giữ một món cuối cùng (Concurrency Race Condition Proof)

### Bản chất bài toán:
Trong kịch bản hai đơn hàng đồng thời (`concurrent requests`) cùng cố gắng giữ 1 sản phẩm cuối cùng (`available_stock = 1`), hệ thống phải đảm bảo tính **Nhất quán Tuyệt đối (Strict Invariant)**:
- Chính xác 1 đơn hàng thành công (`success: true, accepted`).
- Đơn hàng còn lại bắt buộc phải thất bại với lý do hết hàng (`success: false, reason: 'OUT_OF_STOCK'`).
- Tồn khả dụng cuối cùng phải bằng $0$, tồn giữ hàng bằng $1$. Tuyệt đối không được âm kho hay cho phép cả hai cùng thành công.

### Phép thử chứng minh (Verification Test Proof):
Đoạn mã assertion độc lập kích hoạt hai Promise đồng thời tranh chấp món hàng cuối cùng, chứng minh cơ chế Atomic Conditional Update giải quyết hoàn hảo bài toán Concurrency:

```javascript
import assert from 'node:assert/strict';
import {
  ReserveStockUseCase,
  InMemoryInventoryRepository,
} from './apps/inventory-service/src/application/reserve-stock.ts';

// -------------------------------------------------------------
// KHỞI TẠO: SẢN PHẨM CHỈ CÒN DUY NHẤT 1 MÓN TRONG KHO
// -------------------------------------------------------------
const repo = new InMemoryInventoryRepository([
  { productId: 'IPHONE-LAST', availableStock: 1, reservedStock: 0, totalStock: 1, version: 1 },
]);
const reserveUseCase = new ReserveStockUseCase(repo);

// -------------------------------------------------------------
// PHÉP THỬ: 2 ĐƠN HÀNG ĐỒNG THỜI GỬI REQUEST TRANH CHẤP
// -------------------------------------------------------------
const [orderA, orderB] = await Promise.all([
  reserveUseCase.execute({
    orderId: 'ORD-BUYER-A',
    items: [{ productId: 'IPHONE-LAST', quantity: 1 }],
  }),
  reserveUseCase.execute({
    orderId: 'ORD-BUYER-B',
    items: [{ productId: 'IPHONE-LAST', quantity: 1 }],
  }),
]);

// Phân loại kết quả
const winners = [orderA, orderB].filter((res) => res.success);
const losers = [orderA, orderB].filter((res) => !res.success);

// CHỨNG MINH INVARIANTS:
// 1. Chỉ duy nhất 1 đơn chiến thắng
assert.equal(winners.length, 1, 'Chỉ duy nhất 1 đơn hàng được chấp nhận giữ hàng');

// 2. Đơn thua cuộc nhận thông báo hết hàng rõ ràng
assert.equal(losers.length, 1, 'Đơn còn lại bắt buộc nhận kết quả thất bại');
assert.equal(losers[0].reason, 'OUT_OF_STOCK', 'Lý do thất bại phải là OUT_OF_STOCK');

// 3. Tồn kho khả dụng giảm về 0, KHÔNG BỊ ÂM
const finalStock = await repo.getStock('IPHONE-LAST');
assert.equal(finalStock.availableStock, 0, 'Tồn khả dụng chính xác bằng 0');
assert.equal(finalStock.reservedStock, 1, 'Tồn giữ hàng chính xác bằng 1');

console.log('PASS: Phép thử Hai đơn hàng đồng thời giữ món cuối đã được chứng minh thành công!');
```
