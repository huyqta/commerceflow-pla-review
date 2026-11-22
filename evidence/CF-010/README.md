# Evidence CF-010

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 7234928dc0b18c47716b26b1cc8d0cd1545ce1f5
- Commands / exit codes:
  - Command: `node labs/CF-010/demo.mjs`
  - Output: `MICRO_LAB_OK CF-010 (Đã kiểm chứng thực tế Domain tests & Architecture Boundary thành công)`
  - Exit code: `0`
  - Automated Test Suite: `node --test tests/architecture/order-boundary.test.ts`
  - Output: `ℹ tests 13 | ℹ suites 3 | ℹ pass 13 | ℹ fail 0 | ℹ duration_ms 252.0799`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử 1: Vi phạm Invariant trùng lặp sản phẩm trong cùng một đơn hàng (`DUPLICATE_ORDER_ITEM`):
    - Lệnh: `node -e "import('./apps/order-service/src/domain/order.aggregate.ts').then(m => m.Order.create('ord-err', 'c1', [{ productId: 'p1', quantity: 1, unitPrice: 10 }, { productId: 'p1', quantity: 2, unitPrice: 10 }]))"`
    - Observed Output: `Error: DUPLICATE_ORDER_ITEM: Sản phẩm 'p1' bị trùng lặp trong đơn hàng. Hãy gộp số lượng thay vì tạo nhiều dòng.` (Exit code 1).
  - Tình huống kiểm thử 2: Quét phụ thuộc kiến trúc kiểm tra không import ORM trong Domain (`PASS_ZERO_ORM_IN_DOMAIN`):
    - Lệnh: `node -e "const fs = require('fs'); const content = fs.readFileSync('apps/order-service/src/domain/order.aggregate.ts', 'utf8'); if (content.includes('@prisma/client') || content.includes('prisma')) { console.error('FAIL_ORM_IN_DOMAIN'); process.exit(1); } else { console.log('PASS_ZERO_ORM_IN_DOMAIN'); }"`
    - Observed Output: `PASS_ZERO_ORM_IN_DOMAIN` (Exit code 0).
  - Tình huống kiểm thử 3: Chuyển đổi trạng thái bất hợp lệ (Hủy đơn hàng đã được xác nhận thành công):
    - Lệnh: `node -e "import('./apps/order-service/src/domain/order.aggregate.ts').then(m => { const o = m.Order.create('ord-c', 'c1', [{ productId: 'p1', quantity: 1, unitPrice: 10 }]); o.confirm(); o.cancel(); })"`
    - Observed Output: `Error: INVALID_TRANSITION: CANNOT_CANCEL_CONFIRMED_ORDER` (Exit code 1).
  - Giải thích kết quả: Bộ test tự động kiểm soát chặt chẽ cả 3 tầng: tính độc lập của kiến trúc (Zero ORM in Domain), tính toàn vẹn của Domain Aggregate Invariants, và tính an toàn của Application Use Cases khi xử lý lỗi.

[ANSWER]
## 1. Trade-off: Rủi ro khi chỉ kiểm thử kịch bản thành công (Happy-path-only Testing Bias)

Trong kiểm thử phần mềm hướng đối tượng và kiến trúc hướng nghiệp vụ (DDD), thiên kiến chỉ kiểm thử "Happy Path" (các trường hợp người dùng nhập đúng, dữ liệu hoàn hảo, hệ thống chạy trơn tru) là nguyên nhân hàng đầu dẫn đến sự cố thảm khốc khi ra môi trường production:

### Hậu quả nguy hiểm của việc bỏ qua Negative & Boundary Tests:
1. **Ảo tưởng an toàn (False Sense of Security):**
   - Chỉ số Code Coverage (độ bao phủ dòng mã) có thể đạt trên 80%, nhưng hệ thống hoàn toàn không biết phản ứng thế nào khi nhận dữ liệu rác, giá trị biên, hoặc lỗi kết nối.
2. **Lỗ hổng gian lận tài chính & thao túng kho (Financial & Inventory Exploitation):**
   - Nếu không có negative test cho `quantity <= 0` hoặc `unitPrice < 0`, một khách hàng có thể gửi request với `quantity = -5` biến phép trừ tồn kho thành cộng tồn kho trái phép, hoặc giảm trừ tổng tiền hóa đơn thanh toán.
3. **Phá vỡ tính bất biến của trạng thái (Corrupted Domain Invariants):**
   - Đơn hàng đã ở trạng thái `CANCELLED` nhưng người dùng vẫn gọi được hàm `confirm()`, dẫn đến hàng hóa bị trừ kho cho một đơn đã hủy, làm sai lệch sổ sách kế toán.
4. **Chi phí khắc phục sự cố tăng theo cấp số nhân:**
   - Một lỗi Invariant phát hiện bằng unit test trong bộ nhớ RAM tốn dưới $1\text{ giây}$ để sửa.
   - Nhưng khi dữ liệu sai lệch đã ghi vào hàng triệu dòng cơ sở dữ liệu PostgreSQL tại production, việc truy vết, hoàn tiền và rollback dữ liệu đòi hỏi đội ngũ vận hành mất hàng tuần làm việc thủ công.

---

## 2. Thử thách độc lập: Thêm Invariant chống trùng lặp Order Item (`DUPLICATE_ORDER_ITEM`)

### Bản chất bài toán:
Trong nghiệp vụ thương mại điện tử, việc cho phép một đơn hàng chứa nhiều dòng sản phẩm riêng biệt có cùng một mã sản phẩm (`productId`) là một lỗi thiết kế nghiêm trọng:
1. **Xung đột giá và chính sách khuyến mãi:** Nếu cùng một sản phẩm A xuất hiện ở dòng 1 với giá 100k và dòng 2 với giá 80k trong cùng một đơn, hệ thống sẽ rơi vào trạng thái mâu thuẫn khi tính toán hóa đơn hoặc khi áp dụng voucher giảm giá.
2. **Nguy cơ Race Condition khi trừ kho:** Inventory Service khi xử lý giữ hàng theo từng dòng sẽ phải gọi cập nhật cùng một bản ghi sản phẩm nhiều lần trong cùng một transaction, dễ gây deadlock và chậm trễ.
3. **Chuẩn thiết kế eCommerce:** Khi người dùng bấm mua thêm sản phẩm đã có trong giỏ hàng, hệ thống nghiệp vụ bắt buộc phải **gộp số lượng (`quantity = quantity + 1`)** vào duy nhất một dòng `OrderLineItem`.

### Giải pháp thiết kế trong Order Aggregate:
Kiểm tra tính duy nhất của `productId` ngay tại Factory Method `Order.create`:
```typescript
// apps/order-service/src/domain/order.aggregate.ts
const seenProductIds = new Set<string>();
for (const input of itemInputs) {
  const pId = (input.productId || '').trim();
  if (!pId) {
    throw new Error('PRODUCT_ID_REQUIRED: Mã sản phẩm không được để trống');
  }
  if (seenProductIds.has(pId)) {
    throw new Error(
      `DUPLICATE_ORDER_ITEM: Sản phẩm '${pId}' bị trùng lặp trong đơn hàng. Hãy gộp số lượng thay vì tạo nhiều dòng.`
    );
  }
  seenProductIds.add(pId);
}
```

### Phép thử chứng minh (Verification Test):
Đoạn mã assertion độc lập chứng minh quy tắc Invariant chặn đứng việc gửi trùng lặp mặt hàng:

```javascript
import assert from 'node:assert/strict';
import { Order } from './apps/order-service/src/domain/order.aggregate.ts';

// 1. Phép thử đơn hàng chứa 2 sản phẩm trùng mã productId 'prod-IPHONE'
const duplicateItems = [
  { productId: 'prod-IPHONE', quantity: 1, unitPrice: 1000 },
  { productId: 'prod-IPHONE', quantity: 2, unitPrice: 1000 }, // Trùng lặp!
];

assert.throws(
  () => Order.create('ord-test-duplicate', 'cust-001', duplicateItems),
  /DUPLICATE_ORDER_ITEM/,
  'Invariant Test: Order Aggregate bắt buộc phải ném lỗi DUPLICATE_ORDER_ITEM khi có sản phẩm trùng lặp!'
);

// 2. Phép thử đơn hàng hợp lệ với các sản phẩm khác nhau
const distinctItems = [
  { productId: 'prod-IPHONE', quantity: 3, unitPrice: 1000 }, // Đã gộp số lượng thành 3
  { productId: 'prod-CASE', quantity: 1, unitPrice: 50 },
];

const validOrder = Order.create('ord-test-valid', 'cust-001', distinctItems);
assert.equal(validOrder.getItems().length, 2, 'Đơn hàng hợp lệ phải tạo thành công');
assert.equal(validOrder.getTotalAmount(), 3050, 'Tổng tiền tính chính xác: 3*1000 + 1*50 = 3050');

console.log('PASS: Invariant DUPLICATE_ORDER_ITEM đã được chứng minh thành công!');
```
