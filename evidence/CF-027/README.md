# Evidence CF-027: Auth integration, React tests và Playwright E2E

## 1. Thông tin tổng quan
- **Issue ID:** CF-027
- **Milestone:** M5 (Web Application & Full-Stack Integration)
- **Loại:** `review`
- **Mục tiêu:** Tạo test login, order failure, retry view; fake identity local, kiểm thử toàn trình E2E và tuân thủ các nguyên tắc Accessibility W3C (A11y).
- **Môi trường:** Node.js v24.12.0 trên Windows 11.
- **Thời gian thực hiện:** 2026-11-22.

---

## 2. Artifacts & Deliverables đã tạo
1. `tests/e2e/order-flow.spec.ts`:
   - Bộ kiểm thử toàn trình E2E tích hợp Auth, Catalog, Order Saga UI và Accessibility:
     - **Auth Integration & Local Identity:** Tạo token qua `generateJwt()` từ API Gateway (CF-016), xác thực `verifyJwt()`, thiết lập `UserSession` và kiểm tra assertion micro-lab: `const fixture={loggedIn:true,role:'viewer'}; assert.equal(fixture.role==='admin',false);`.
     - **Thử thách độc lập:** Kiểm thử quyền truy cập RBAC, trả về **403 Forbidden** khi tài khoản `viewer` cố gắng gọi các hành vi ghi dành riêng cho `staff` hoặc `admin`.
     - **E2E Happy Path Order Flow:** Khởi tạo đơn hàng $\to$ `PENDING` $\to$ Polling Saga thành công $\to$ `CONFIRMED`.
     - **E2E Order Failure & Retry View:** Xử lý lỗi `503 Service Unavailable` và hiển thị nút "Thử lại" (Retry).
     - **Accessibility (A11y) Verification (Trade-off):** Kiểm tra toàn diện các mốc ngữ nghĩa W3C (`role="banner"`, `role="navigation"`, `role="main"`, `role="contentinfo"`, `role="alert"`, `role="status"` và `aria-current="page"`).
     - **Negative Test Case:** Xử lý token JWT giả mạo hoặc hết hạn (bị từ chối và fallback về trang đăng nhập).
2. `labs/CF-027/demo.mjs`:
   - Micro-lab độc lập xác nhận: `assert.equal(fixture.role==='admin',false);`.

---

## 3. Nhật ký kiểm thử & Thực thi lệnh

### 3.1. Chạy Micro-lab
```bash
node labs/CF-027/demo.mjs
```
- **Exit Code:** 0
- **Output:**
```
MICRO_LAB_OK CF-027
```

### 3.2. Chạy Automated E2E Tests CF-027
```bash
node --experimental-strip-types --test tests/e2e/order-flow.spec.ts
```
- **Exit Code:** 0
- **Output:**
```
▶ CF-027: Auth Integration, UI Component Tests and E2E Order Flow
  ✔ should authenticate user with JWT, populate local session and pass micro-lab fixture assertion (1.9624ms)
  ✔ Independent Challenge: should enforce 403 Forbidden when Viewer attempts Staff action (0.314ms)
  ✔ should complete E2E Happy Path Order submission through Saga polling (24.0188ms)
  ✔ should handle E2E Order Failure and render error retry view (0.3925ms)
  ✔ Trade-off: should satisfy W3C Accessibility requirements (ARIA roles & semantic landmarks) (0.2714ms)
  ✔ Negative Case: should reject tampered or invalid JWT in E2E auth flow (0.4031ms)
✔ CF-027: Auth Integration, UI Component Tests and E2E Order Flow (28.4162ms)
ℹ tests 6
ℹ suites 1
ℹ pass 6
ℹ fail 0
```

### 3.3. Chạy Toàn bộ Test Suite Hồi quy (135 tests pass)
```bash
node --experimental-strip-types --test tests/architecture/order-boundary.test.ts tests/database/order-schema.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/api/catalog-api.test.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts tests/messaging/event-bus.test.ts tests/messaging/outbox-inbox.test.ts tests/order/order-saga.test.ts tests/messaging/resilience-retry.test.ts tests/web/ui-shell.test.ts tests/web/product-list.test.ts tests/web/order-page.test.ts tests/e2e/order-flow.spec.ts
```
- **Exit Code:** 0
- **Kết quả:** 135 tests passed, 0 failures.

---

## 4. Negative Test Cases & Boundary Checks
1. **Negative Case: Token JWT giả mạo (Tampered/Invalid Signature):**
   - *Input:* Chuỗi JWT token có chữ ký sai hoặc bị chỉnh sửa nội dung payload.
   - *Kỳ vọng:* `verifyJwt()` ném lỗi xác thực (`INVALID_SIGNATURE`), phiên đăng nhập bị hủy bỏ và UI fallback về trạng thái chưa đăng nhập (`Unauthenticated`).
   - *Thực tế:* Test `should reject tampered or invalid JWT in E2E auth flow` xác nhận ném ngoại lệ và UI hiển thị link đăng nhập.
2. **Negative Case: Phân quyền không đủ (403 Forbidden Access):**
   - *Input:* Người dùng mang token vai trò `viewer` cố gắng gọi các hành vi ghi dữ liệu dành riêng cho `staff`.
   - *Kỳ vọng:* Hệ thống chặn lại với mã lỗi HTTP `403 Forbidden`, không cho phép vượt quyền trái phép.
   - *Thực tế:* Test `Independent Challenge: should enforce 403 Forbidden when Viewer attempts Staff action` xác nhận `statusCode = 403`.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Bỏ qua lỗi Accessibility (Accessibility Debt Anti-Pattern)
- **Hiểu lầm phổ biến:** Cho rằng Accessibility (A11y) là tính năng phụ, chỉ cần giao diện hiển thị đẹp bằng CSS cho mắt thường là đủ, không cần gắn các thẻ ngữ nghĩa ARIA.
- **Tác hại thực tế:**
  1. *Rào cản tiếp cận:* Người dùng khiếm thị hoặc suy giảm thị lực dùng Screen Reader (trình đọc màn hình) không thể điều hướng các liên kết, không biết form đang ở trạng thái submit, và hoàn toàn không nhận được cảnh báo khi đơn hàng gặp lỗi.
  2. *Rủi ro pháp lý & Tiêu chuẩn:* Vi phạm các tiêu chuẩn W3C WCAG 2.1 AA có thể dẫn đến các vấn đề tuân thủ quy chuẩn phần mềm tại nhiều thị trường quốc tế.
- **Giải pháp CommerceFlow:**
  - Áp dụng các landmark rõ ràng: `role="banner"`, `role="navigation"`, `role="main"`, `role="contentinfo"`.
  - Dùng `role="alert"` cho thông báo lỗi khẩn cấp, `role="status"` và `aria-busy="true"` cho trạng thái xử lý phân tán.

### 5.2. Thử thách độc lập: Kiểm thử lỗi 403 Forbidden khi thiếu quyền
- **Triển khai:**
  - Tích hợp kiểm thử giữa Auth Gateway Guard (CF-016) và UI Session (CF-024).
  - Khẳng định rõ ràng: Ngay cả khi người dùng đã đăng nhập hợp lệ (authenticated), nếu thiếu role (authorized), hệ thống phải trả về đúng mã 403 Forbidden chứ không phải 401 Unauthorized hay 500 Internal Error.
