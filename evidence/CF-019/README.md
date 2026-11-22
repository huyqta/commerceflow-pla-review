# Evidence CF-019 — Tách Ordering/Payment và hợp đồng API

**Status:** `verified`  
**Milestone:** M4  
**Date:** 2026-11-22  
**Environment:**
- OS: Windows 11 (pwsh / PowerShell 7)
- Node.js: `v24.12.0`
- Revision Git SHA: `650a90e` (và các commit kế tiếp)

---

## 1. Mục tiêu và Bối cảnh Nghiệp vụ
Xây dựng và chuẩn hóa các hợp đồng giao tiếp (Versioned API & Integration Event Contracts) cho các dịch vụ Ordering Service và Payment Service:
- Tạo hợp đồng dữ liệu thuần túy (Pure Data Contracts): Tách biệt hoàn toàn giữa API/Event Contracts với Domain Implementation (Không rò rỉ Aggregate Root hay Database Entities ra bên ngoài).
- Định nghĩa Versioned Schemas (`v1`, `v2`) cho các Integration Events (`OrderCreated`, `PaymentProcessed`) và Commands (`ChargePaymentCommand`).
- Đảm bảo tính tương thích ngược (Backward Compatibility): Thêm optional field trong phiên bản mới mà không làm gãy các consumer đang sử dụng schema cũ.
- Thực hiện kiểm thử tính tương thích và các trường hợp lỗi biên (Negative Contract Validation).

---

## 2. Artifacts Tạo Mới & Chỉnh Sửa
1. `packages/contracts/src/order.ts` — Thư viện Hợp đồng API và Sự kiện phân phiên bản:
   - `OrderCreatedIntegrationEventV1` & `OrderCreatedIntegrationEventV2` (với optional `customerEmail`, `shippingAddress`).
   - `ChargePaymentCommand` & `PaymentProcessedIntegrationEvent`.
   - Các hàm validator nghiêm ngặt: `validateOrderCreatedEventV1`, `validateOrderCreatedEventV2`, `validateChargePaymentCommand`, `validatePaymentProcessedEvent`.
   - Lớp lỗi chuẩn hóa: `ContractValidationError`.
2. `labs/CF-019/demo.mjs` — Micro-lab kiểm tra assertions độc lập: format tin nhắn versioned (`version: 1`), sự tồn tại của artifact, các interface V1/V2 và kiểm tra nguyên tắc Pure Data Contracts (cấm phụ thuộc domain entities).
3. `tests/contracts/order-contract.test.ts` — Bộ automated test suite với 10 tests kiểm tra Happy Path, Backward Compatibility và 5 Negative Cases.

---

## 3. Lệnh Thực Thi & Kết Quả Xác Minh

### 3.1. Chạy Micro-lab CF-019
```powershell
node labs/CF-019/demo.mjs
```
**Output:**
```
[CF-019 Micro-Lab] Bắt đầu kiểm tra Hợp đồng API (Versioned Contracts & Schemas)...
✔ Toàn bộ kiểm tra versioned contracts CF-019 đều HỢP LỆ.
MICRO_LAB_OK CF-019
```
**Exit Code:** `0`

### 3.2. Chạy Automated Tests cho Hợp đồng API
```powershell
node --test tests/contracts/order-contract.test.ts
```
**Output:**
```
▶ 1. Versioned Event Contracts (OrderCreated V1 & V2)
  ✔ Tạo và xác thực OrderCreatedEvent V1 thành công với dữ liệu hợp lệ (3.2572ms)
  ✔ Thử thách độc lập: Thêm field optional vào V2 không làm gãy consumer đọc cấu trúc dữ liệu cốt lõi (Backward Compatibility) (0.4662ms)
✔ 1. Versioned Event Contracts (OrderCreated V1 & V2) (4.8581ms)
▶ 2. Negative & Boundary Test Cases cho Event Contracts
  ✔ Negative Case: Từ chối event khi thiếu hoặc sai kiểu trường bắt buộc (orderId rỗng) (0.6994ms)
  ✔ Negative Case: Từ chối event khi danh sách items rỗng (0.2305ms)
  ✔ Negative Case: Từ chối event khi quantity là số âm hoặc số thập phân (0.2489ms)
  ✔ Negative Case: Từ chối event khi version không khớp (Version Mismatch) (0.1893ms)
✔ 2. Negative & Boundary Test Cases cho Event Contracts (1.6405ms)
▶ 3. Payment Service Contracts (Commands & Events)
  ✔ Xác thực ChargePaymentCommand thành công với đầy đủ tham số (0.2525ms)
  ✔ Negative Case: Từ chối ChargePaymentCommand khi amount <= 0 hoặc thiếu idempotencyKey (0.1837ms)
  ✔ Xác thực PaymentProcessedIntegrationEvent thành công (0.1978ms)
  ✔ Negative Case: Từ chối PaymentProcessedIntegrationEvent với status không hợp lệ (0.2292ms)
✔ 3. Payment Service Contracts (Commands & Events) (1.1108ms)
ℹ tests 10
ℹ suites 3
ℹ pass 10
ℹ fail 0
```
**Exit Code:** `0`

### 3.3. Chạy Hồi quy Toàn bộ Dự Án
```powershell
node --test tests/database/order-schema.test.ts tests/api/catalog-api.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/integration/order-api.spec.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts
```
**Kết quả:** 83/83 tests pass 100% (Thời gian chạy: ~340ms).

---

## 4. Tình Huống Biên & Negative Test Cases

### Tình huống 1: Thiếu trường bắt buộc trong Event Payload (Empty OrderId)
- **Kịch bản:** Ordering Service phát event `OrderCreated` nhưng `orderId` rỗng hoặc bị thiếu do lỗi runtime.
- **Hành vi:** Hàm `validateOrderCreatedEventV1` ném ra `ContractValidationError` với chi tiết lỗi `Payload thiếu orderId`.
- **Kết quả:** Consumer từ chối xử lý, ngăn ngừa lỗi dữ liệu rác trong database.

### Tình huống 2: Items rỗng hoặc Quantity không hợp lệ (Số âm / Thập phân)
- **Kịch bản:** Payload chứa `items: []` hoặc item có `quantity: -2`.
- **Hành vi:** Validator từ chối với lỗi `items phải là mảng có ít nhất 1 phần tử` và `quantity phải là số nguyên dương`.

### Tình huống 3: Lệch phiên bản Schema (Version Mismatch)
- **Kịch bản:** Consumer V1 nhận được event có `version: 99`.
- **Hành vi:** Hệ thống phát hiện sự không tương thích và ném lỗi `version phải là 1`.

### Tình huống 4: Command thanh toán thiếu Idempotency Key hoặc Amount âm
- **Kịch bản:** Lệnh `ChargePaymentCommand` gửi tới Payment Service có `amount: -10` và thiếu `idempotencyKey`.
- **Hành vi:** `validateChargePaymentCommand` chặn ngay lập tức, trả về danh sách lỗi cụ thể.

---

## 5. Engineering Judgment & Phân tích Đánh đổi (Trade-off Analysis)

### Trade-off: Chia sẻ Domain Implementation qua Common Package (Shared Library) vs. Pure Data Contracts
- **Chia sẻ Domain Implementation (Anti-pattern):**
  - Đóng gói cả `OrderAggregate`, Prisma Entity Models, hoặc business methods vào một thư viện dùng chung `shared-kernel` rồi npm install vào các microservices.
  - *Hậu quả tiêu cực:*
    - Tạo ra "Distributed Monolith" với coupling rất cao: Thay đổi logic domain của Ordering làm gãy build và đòi hỏi deploy lại Payment, Inventory, Catalog.
    - Rò rỉ ranh giới nghiệp vụ (Leaky Abstraction): Các service khác có thể vô tình gọi các phương thức nội bộ của Order Aggregate mà không qua API contract.
- **Pure Data Contracts (Lựa chọn của CommerceFlow):**
  - Package `packages/contracts` chỉ chứa TypeScript interfaces, JSON schema types, DTOs và validation helpers.
  - Không chứa bất kỳ class entity, ORM mapping hay business logic nào.
  - Mỗi service tự do cài đặt domain logic và database schema của mình, miễn là tuân thủ contract dữ liệu.

---

## 6. Lời giải Thử thách Độc lập (Independent Challenge Solution)

> **Câu hỏi:** Thêm field optional không breaking? Mô tả một ví dụ và một phép thử để chứng minh.

### 1. Nguyên lý Thiết kế (Tolerant Reader Pattern):
- Khi tiến hóa hệ thống phân tán, các thay đổi contract phải tuân thủ nguyên tắc:
  1. Không xóa trường bắt buộc cũ.
  2. Không đổi kiểu dữ liệu của trường cũ.
  3. Mọi trường mới bổ sung bắt buộc phải là **Optional** (không bắt buộc).
- Consumer áp dụng mẫu thiết kế **Tolerant Reader**: Chỉ trích xuất và xử lý các trường dữ liệu mà nó hiểu và cần thiết cho nghiệp vụ của nó; các trường mới/bổ sung chưa hiểu sẽ được bỏ qua một cách an toàn mà không gây crash ứng dụng.

### 2. Phép thử Thực tế Đã Chứng Minh (Verification Test):
- Trong test suite [`tests/contracts/order-contract.test.ts`](file:///e:/10_WORKS/AI_SKILL/commerceflow-pla-v1.2-review/commerceflow-pla-review/tests/contracts/order-contract.test.ts) (Suite 1, Test 2):
  - Định nghĩa `OrderCreatedPayloadV2` kế thừa `OrderCreatedPayloadV1`, bổ sung 2 optional fields: `customerEmail?: string` và `shippingAddress?: object`.
  - Khởi tạo event V2 mang đầy đủ thông tin địa chỉ giao hàng và email.
  - Giả lập một Consumer cũ (chỉ nhận thức được cấu trúc V1): Consumer này đọc `event.payload` và trích xuất `orderId`, `totalAmount`, `items`.
  - Phép thử chứng minh consumer cũ xử lý chính xác 100% dữ liệu mà không bị lỗi cú pháp hay runtime exception.
