# Evidence CF-013

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 7234928dc0b18c47716b26b1cc8d0cd1545ce1f5
- Commands / exit codes:
  - Command: `node labs/CF-013/demo.mjs`
  - Output: `MICRO_LAB_OK CF-013`
  - Exit code: `0`
  - Automated Test Suite (Catalog REST API & Validation): `node --test tests/api/catalog-api.test.ts`
  - Output: `ℹ tests 12 | ℹ suites 4 | ℹ pass 12 | ℹ fail 0 | ℹ duration_ms 180.6946`
  - Exit code: `0`
  - Database Schema & ACID Tests: `node --test tests/database/order-schema.test.ts`
  - Output: `ℹ tests 12 | ℹ suites 3 | ℹ pass 12 | ℹ fail 0 | ℹ duration_ms 189.3859`
  - Exit code: `0`
  - Architecture Boundary Tests: `node --test tests/architecture/order-boundary.test.ts`
  - Output: `ℹ tests 13 | ℹ suites 3 | ℹ pass 13 | ℹ fail 0 | ℹ duration_ms 216.4348`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử 1 (Thử thách độc lập): Gửi payload tạo sản phẩm với giá âm (`price = -50`):
    - Lệnh: `node -e "import('./apps/catalog-service/src/catalog.controller.ts').then(m => m.validateCreateProductDto({ sku: 'PROD-NEG', name: 'Item', price: -50 }))"`
    - Observed Output: `HttpException: VALIDATION_FAILED: INVALID_PRICE: Giá sản phẩm không được là số âm (price >= 0). { statusCode: 400, errorCode: 'BAD_REQUEST' }` (Exit code 1).
  - Tình huống kiểm thử 2 (Kịch bản R-06 Security): Yêu cầu ghi (`POST /products`) không có Authentication Token:
    - Lệnh: `node -e "import('./apps/catalog-service/src/catalog.controller.ts').then(m => { const c = new m.CatalogController(); return c.createProduct({ sku: 'P1', name: 'N', price: 10 }); })"`
    - Observed Output: `HttpException: UNAUTHORIZED: Yêu cầu cung cấp Authentication Token { statusCode: 401, errorCode: 'UNAUTHORIZED' }` (Exit code 1).
  - Tình huống kiểm thử 3 (Kịch bản R-06 Security): Người dùng vai trò `viewer` cố tình gọi write endpoint `POST /products`:
    - Lệnh: `node -e "import('./apps/catalog-service/src/catalog.controller.ts').then(m => { const c = new m.CatalogController(); return c.createProduct({ sku: 'P1', name: 'N', price: 10 }, { user: { id: 'u1', username: 'v', role: 'viewer' } }); })"`
    - Observed Output: `HttpException: FORBIDDEN: Người dùng vai trò 'viewer' không được phép thực hiện thao tác ghi trên Catalog! { statusCode: 403, errorCode: 'FORBIDDEN' }` (Exit code 1).
  - Tình huống kiểm thử 4: Xung đột dữ liệu khi tạo sản phẩm có SKU đã tồn tại (`SKU_ALREADY_EXISTS`):
    - Lệnh: `node -e "import('./apps/catalog-service/src/catalog.controller.ts').then(async m => { const c = new m.CatalogController(); const auth = { user: { id: '1', username: 'a', role: 'admin' } }; await c.createProduct({ sku: 'SKU-DUP', name: 'N1', price: 10 }, auth); await c.createProduct({ sku: 'SKU-DUP', name: 'N2', price: 20 }, auth); })"`
    - Observed Output: `HttpException: CONFLICT: SKU_ALREADY_EXISTS: Sản phẩm có SKU 'SKU-DUP' đã tồn tại trong catalog. { statusCode: 409, errorCode: 'CONFLICT' }` (Exit code 1).
  - Giải thích kết quả: Hệ thống áp dụng triệt để nguyên lý Fail-fast tại tầng Controller/DTO Validation, kết hợp phân quyền RBAC và kiểm soát tính duy nhất của dữ liệu, ngăn chặn 100% dữ liệu bẩn và truy cập trái phép trước khi chạm đến tầng lưu trữ.

[ANSWER]
## 1. Trade-off: Rủi ro khi trả Entity nội bộ trực tiếp ra API (Entity Leaking Hazards & DTO Decoupling)

Trong phát triển API hiện đại, việc lập trình viên trực tiếp trả về các thực thể cơ sở dữ liệu hoặc domain entity (ORM models như Prisma/TypeORM/Mongoose) ra response HTTP là một anti-pattern phổ biến và nguy hiểm:

### Các rủi ro nghiêm trọng khi để rò rỉ Entity (Entity Leaking):
1. **Lỗ hổng rò rỉ dữ liệu nhạy cảm (Security & Data Overexposure - OWASP API3:2023):**
   - Bảng `products` hoặc domain entity thường chứa các trường nội bộ như:
     - `internalCost` (Giá vốn nhập hàng - bí mật kinh doanh cạnh tranh).
     - `supplierId`, `supplierNotes` (Thông tin đối tác và thỏa thuận chiết khấu).
     - `isDeleted` (Cờ xóa mềm - nếu lộ ra, người dùng biết sản phẩm đã bị hủy).
     - `version`, `auditHistory` (Chi tiết kỹ thuật cơ sở dữ liệu).
   - Nếu trả trực tiếp entity, các trường này sẽ bị serialize thành JSON gửi về client, kẻ tấn công hoặc đối thủ có thể dễ dàng khai thác.
2. **Khớp nối chặt chẽ giữa Database Schema và Public API Contract (Tight Coupling):**
   - Khi cấu trúc bảng cơ sở dữ liệu thay đổi (ví dụ đổi tên cột từ `price` sang `unit_price`, hoặc tách bảng giá thành bảng `price_tiers`), Public API Contract của hệ thống sẽ bị vỡ vụn (breaking change), làm hỏng ứng dụng di động hoặc đối tác đang tích hợp.
3. **Lỗ hổng gán hàng loạt (Mass Assignment Vulnerability - OWASP API6:2023):**
   - Nếu dùng chung một entity cho cả Input và Output, kẻ tấn công có thể chèn thêm các trường như `{ "isDeleted": true, "internalCost": 0 }` trong body request để thao túng dữ liệu hệ thống trái phép.

### Giải pháp chuẩn thiết kế: Data Transfer Object (DTO) & Explicit Mapping
- **Phân tách hoàn toàn:** Định nghĩa riêng `CreateProductDto`, `ProductQueryDto` cho tầng tiếp nhận request, và `ProductResponseDto` cho tầng phản hồi dữ liệu.
- **Hàm ánh xạ tường minh (`toProductResponseDto`):** Chỉ trích xuất các trường công khai hợp lệ (`id`, `sku`, `name`, `description`, `price`, `currency`, `availableStock`, `createdAt`). Toàn bộ các trường nội bộ bị loại bỏ hoàn toàn khỏi JSON response.

---

## 2. Thử thách độc lập: Thiết kế Negative Test cho Giá âm (Negative Price)

### Bản chất bài toán nghiệp vụ:
Trong hệ thống thương mại điện tử (eCommerce), giá sản phẩm (`price`) là bất biến nghiệp vụ tối quan trọng:
1. **Giá sản phẩm phải là số thực hữu hạn không âm (`price >= 0`):**
   - Giá có thể bằng $0$ (áp dụng cho quà tặng khuyến mãi kèm đơn hoặc sản phẩm dùng thử miễn phí).
   - Nhưng giá **TUYỆT ĐỐI KHÔNG ĐƯỢC là số âm (`price < 0`)** hoặc `NaN`, `Infinity`.
2. **Hậu quả nếu lọt giá âm vào hệ thống:**
   - Khi khách hàng đặt đơn hàng gồm sản phẩm bình thường (giá 500k) và sản phẩm có giá âm (-200k), tổng tiền thanh toán của đơn hàng sẽ bị giảm trừ trái phép xuống còn 300k.
   - Thậm chí, nếu tổng tiền đơn hàng âm, cổng thanh toán hoặc hệ thống hoàn tiền tự động có thể chuyển tiền ngược lại vào tài khoản kẻ gian (Financial Fraud Exploit).

### Mã kiểm thử âm tính (Negative Test Proof):
Đoạn mã assertion độc lập chứng minh bộ lọc validation bắt chặt chẽ giá âm và ném `BadRequestException` với HTTP status 400:

```javascript
import assert from 'node:assert/strict';
import { validateCreateProductDto, BadRequestException } from './apps/catalog-service/src/catalog.controller.ts';

// -------------------------------------------------------------
// PHÉP THỬ: GỬI PAYLOAD VỚI GIÁ ÂM (PRICE = -99000)
// -------------------------------------------------------------
assert.throws(
  () => {
    validateCreateProductDto({
      sku: 'PROD-EXPLOIT-01',
      name: 'Sản phẩm hack giá',
      price: -99000,
    });
  },
  (err) => {
    // 1. Phải là instance của BadRequestException
    assert.ok(err instanceof BadRequestException, 'Lỗi phải là BadRequestException');
    // 2. HTTP Status Code bắt buộc phải là 400
    assert.equal(err.statusCode, 400, 'HTTP status code phải là 400');
    // 3. Mã lỗi nghiệp vụ rõ ràng
    assert.match(err.message, /INVALID_PRICE/, 'Thông điệp lỗi phải nêu rõ vi phạm INVALID_PRICE');
    return true;
  }
);

console.log('PASS: Phép thử Negative Test cho Giá âm đã được chứng minh thành công!');
```
