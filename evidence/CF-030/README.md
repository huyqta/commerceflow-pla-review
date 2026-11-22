# Evidence CF-030: Contract/E2E/security testing matrix

## 1. Thông tin tổng quan
- **Issue ID:** CF-030
- **Milestone:** M6 (Containerization, Kubernetes & Production Readiness)
- **Loại:** `review`
- **Mục tiêu:** Lập bảng ma trận kiểm thử toàn diện (Positive, Negative, Contract, Security), phát hiện tình huống phá vỡ hợp đồng dữ liệu (Consumer Contract Break), và phân tích rủi ro ảo tưởng tỷ lệ bao phủ code (Code Coverage Illusion).
- **Môi trường:** Node.js v24.12.0 trên Windows 11.
- **Thời gian thực hiện:** 2026-11-22.

---

## 2. Artifacts & Deliverables đã tạo
1. `docs/testing/test-matrix.md`:
   - Bảng ma trận phân loại chi tiết 30 kịch bản kiểm thử bao hàm 4 nhóm trọng yếu:
     - **Positive Tests:** Khởi tạo Value Objects, đặt hàng thành công, Saga hoàn tất, JWT token hợp lệ.
     - **Negative & Boundary Tests:** Số lượng âm, tiền tệ âm, giỏ hàng rỗng, mã trùng lặp, chuyển trạng thái đơn hàng bất hợp lệ (State Machine Protection), tranh chấp trừ kho đồng thời (409 Conflict).
     - **Consumer-Driven Contract Tests:** Khớp Schema V1/V2, nhận diện Breaking Changes khi thiếu trường `orderId` hoặc đổi kiểu dữ liệu.
     - **Security Tests:** Xác thực AuthN JWT, chặn 401 khi thiếu token, chặn 403 Forbidden khi `viewer` gọi lệnh ghi của `staff`, chống lộ lọt `.env` qua Dockerfile và khóa quyền CI `contents: read`.
2. `tests/testing/test-matrix.test.ts`:
   - Bộ 4 automated tests:
     - Kiểm tra sự tồn tại của `docs/testing/test-matrix.md` và khớp assertion micro-lab: `const contract={schemaVersion:1,required:['eventId','orderId']}; assert.ok(contract.required.includes('eventId'));`.
     - **Thử thách độc lập:** Giả lập và phát hiện kịch bản phá vỡ hợp đồng tiêu dùng (**Consumer Contract Break Scenario**) khi Producer đổi tên trường `orderId` thành `id` hoặc đổi kiểu dữ liệu từ chuỗi sang số.
     - **Trade-off:** Kiểm tra ma trận có ít nhất 25+ test cases bao phủ cả 4 phân loại chứ không dừng ở Line Coverage.
     - **Negative Case:** Kiểm tra sự kiện thiếu `schemaVersion` hoặc phiên bản âm.
3. `labs/CF-030/demo.mjs`:
   - Micro-lab độc lập xác nhận: `assert.ok(contract.required.includes('eventId'));`.

---

## 3. Nhật ký kiểm thử & Thực thi lệnh

### 3.1. Chạy Micro-lab
```bash
node labs/CF-030/demo.mjs
```
- **Exit Code:** 0
- **Output:**
```
MICRO_LAB_OK CF-030
```

### 3.2. Chạy Automated Unit Tests CF-030
```bash
node --experimental-strip-types --test tests/testing/test-matrix.test.ts
```
- **Exit Code:** 0
- **Output:**
```
▶ CF-030: Comprehensive Testing Matrix (Positive, Negative, Contract, Security)
  ✔ should verify docs/testing/test-matrix.md exists and contains contract definition matching micro-lab (1.5865ms)
  ✔ Independent Challenge: should simulate and detect Consumer Contract Break scenario (0.2473ms)
  ✔ Trade-off: should verify testing matrix covers all 4 critical categories beyond line coverage (0.4504ms)
  ✔ Negative Case: should reject events without schemaVersion or with negative version (0.9858ms)
✔ CF-030: Comprehensive Testing Matrix (Positive, Negative, Contract, Security) (4.3724ms)
ℹ tests 4
ℹ suites 1
ℹ pass 4
ℹ fail 0
```

### 3.3. Chạy Toàn bộ 19 Test Suites Hồi quy (149 tests pass)
```bash
node --experimental-strip-types --test tests/architecture/order-boundary.test.ts tests/database/order-schema.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/api/catalog-api.test.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts tests/messaging/event-bus.test.ts tests/messaging/outbox-inbox.test.ts tests/order/order-saga.test.ts tests/messaging/resilience-retry.test.ts tests/web/ui-shell.test.ts tests/web/product-list.test.ts tests/web/order-page.test.ts tests/e2e/order-flow.spec.ts tests/docker/docker-health.test.ts tests/ci/ci-pipeline.test.ts tests/testing/test-matrix.test.ts
```
- **Exit Code:** 0
- **Kết quả:** 149 tests passed, 0 failures.

---

## 4. Negative Test Cases & Boundary Checks
1. **Negative Case: Producer phá vỡ Hợp đồng (Contract Breaking Change):**
   - *Input:* Producer phát ra sự kiện thiếu trường bắt buộc `orderId` (ví dụ sửa nhầm thành `id` hoặc xóa bỏ).
   - *Kỳ vọng:* Consumer Contract Validator phát hiện ngay lập tức và ném `CONTRACT_BREAK: orderId is required but missing or invalid`, ngăn chặn việc ném `NullPointerException` hoặc ghi nhận sai dữ liệu trong cơ sở dữ liệu.
   - *Thực tế:* Test `should simulate and detect Consumer Contract Break scenario` kiểm chứng thành công.
2. **Negative Case: Sai kiểu dữ liệu trong Payload (Type Mismatch):**
   - *Input:* Trường `orderId` được truyền vào dưới dạng số nguyên `123456` thay vì chuỗi ký tự.
   - *Kỳ vọng:* Bị từ chối tại tầng Contract Validation.
   - *Thực tế:* Test xác nhận ném lỗi `CONTRACT_BREAK`.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Ảo tưởng Tỷ lệ Bao phủ Code (Code Coverage Illusion)
- **Hiểu lầm phổ biến:** Đạt 100% Code Coverage nghĩa là phần mềm đã hoàn hảo và sẵn sàng lên Production mà không còn lỗi.
- **Rủi ro thực tế:**
  1. *Thiếu Assertions nghiệp vụ:* Một bài test có thể chạy qua toàn bộ các dòng code nhưng không kiểm tra (assert) các trạng thái biên của cơ sở dữ liệu hoặc bất biến nghiệp vụ.
  2. *Bỏ sót bài toán đồng thời (Concurrency):* Line coverage không thể phát hiện lỗi Deadlock hoặc Race Condition khi nhiều request trừ kho cùng một lúc.
  3. *Không kiểm thử lỗ hổng bảo mật:* Code vẫn đạt 100% coverage ngay cả khi hoàn toàn thiếu logic phân quyền (RBAC) hoặc không có xác thực JWT.
- **Giải pháp của CommerceFlow:** Lập ma trận kiểm thử 4 trụ cột (Positive, Negative/Boundary, Contract, Security) kết hợp Failure Injections để đo lường chất lượng hệ thống theo hành vi thực tế.

### 5.2. Thử thách độc lập: Kịch bản Phá vỡ Hợp đồng Tiêu dùng (Consumer Contract Break)
- **Nguyên lý:** Trong kiến trúc Microservices phân tán, các team làm việc độc lập. Việc thay đổi schema của Producer nếu không được kiểm soát qua Consumer-Driven Contracts sẽ biến các sự kiện trở thành "Poison Pills" làm sập các consumer downstream.
- **Phép thử:** Tạo validator trên consumer kiểm tra `schemaVersion >= 1` và sự hiện diện của các thuộc tính bắt buộc `['eventId', 'orderId']`. Khi phát hiện vi phạm, hệ thống tự động đưa vào Dead-Letter Queue (DLQ) để xử lý an toàn.
