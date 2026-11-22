# Evidence CF-026: Order Management và state transitions UI

## 1. Thông tin tổng quan
- **Issue ID:** CF-026
- **Milestone:** M5 (Web Application & Full-Stack Integration)
- **Loại:** `implementation`
- **Mục tiêu:** Tạo order submission và polling trạng thái eventual consistency, theo dõi Saga state transitions trên UI.
- **Môi trường:** Node.js v24.12.0 trên Windows 11.
- **Thời gian thực hiện:** 2026-11-22.

---

## 2. Artifacts & Deliverables đã tạo
1. `apps/web/src/features/orders/OrderPage.tsx` (và `apps/web/src/features/orders/OrderPage.ts`):
   - Cài đặt `ORDER_STATUS_LABELS`:
     - `PENDING`: 'Đang xử lý'
     - `CONFIRMED`: 'Đã xác nhận'
     - `CANCELLED`: 'Đã hủy'
     - `REJECTED`: 'Bị từ chối'
     - `TIMEOUT`: 'Quá thời gian xử lý'
   - Cài đặt `OrderPageComponent`:
     - `submitOrder(customerId, items)`: Khởi tạo đơn hàng với trạng thái bắt buộc là `PENDING` (không bao giờ chuyển thẳng CONFIRMED).
     - `pollNextStatus(fetchStatusFromServer)`: Cơ chế polling trạng thái Eventual Consistency từ server theo chu kỳ.
     - **Thử thách độc lập (Timeout Detection):** Tự động phát hiện khi trạng thái Pending bị treo quá lâu vượt giới hạn polling (`maxPollAttempts`) $\to$ chuyển trạng thái `TIMEOUT` và ghi lý do vào `statusHistory`.
     - `render()`: Hiển thị form tạo đơn hoặc chi tiết đơn hàng kèm Saga Timeline ngữ nghĩa (`<ul class="timeline-list">`).
2. `tests/web/order-page.test.ts`:
   - Bộ 6 automated tests:
     - Nhãn tiếng Việt chính xác chuẩn micro-lab.
     - Khởi tạo đơn với trạng thái `PENDING` và kích hoạt polling (Trade-off).
     - Chuyển trạng thái `CONFIRMED` khi polling thành công.
     - Chuyển trạng thái `CANCELLED`/`REJECTED` khi Saga thất bại hoặc hết hàng.
     - Phát hiện pending kéo dài và chuyển trạng thái `TIMEOUT` (Thử thách độc lập).
     - Negative test: từ chối tạo đơn khi thiếu `customerId` hoặc `items` rỗng.
3. `labs/CF-026/demo.mjs`:
   - Micro-lab độc lập xác nhận: `assert.equal(labels.PENDING,'Đang xử lý');`.

---

## 3. Nhật ký kiểm thử & Thực thi lệnh

### 3.1. Chạy Micro-lab
```bash
node labs/CF-026/demo.mjs
```
- **Exit Code:** 0
- **Output:**
```
MICRO_LAB_OK CF-026
```

### 3.2. Chạy Automated Unit Tests CF-026
```bash
node --experimental-strip-types --test tests/web/order-page.test.ts
```
- **Exit Code:** 0
- **Output:**
```
▶ CF-026: Order Management and State Transitions UI
  ✔ should define accurate Vietnamese labels for all order states matching micro-lab (1.3253ms)
  ✔ Trade-off: should start with PENDING state upon submission, never early CONFIRMED (22.6853ms)
  ✔ should transition to CONFIRMED when polling receives completed Saga status (0.3898ms)
  ✔ should transition to CANCELLED/REJECTED when Saga fails or runs out of stock (0.2896ms)
  ✔ Independent Challenge: should detect prolonged pending state and transition to TIMEOUT (0.2193ms)
  ✔ Negative Case: should reject order submission with empty customerId or items (0.4917ms)
✔ CF-026: Order Management and State Transitions UI (26.387ms)
ℹ tests 6
ℹ suites 1
ℹ pass 6
ℹ fail 0
```

### 3.3. Chạy Toàn bộ Test Suite Hồi quy (129 tests pass)
```bash
node --experimental-strip-types --test tests/architecture/order-boundary.test.ts tests/database/order-schema.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/api/catalog-api.test.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts tests/messaging/event-bus.test.ts tests/messaging/outbox-inbox.test.ts tests/order/order-saga.test.ts tests/messaging/resilience-retry.test.ts tests/web/ui-shell.test.ts tests/web/product-list.test.ts tests/web/order-page.test.ts
```
- **Exit Code:** 0
- **Kết quả:** 129 tests passed, 0 failures.

---

## 4. Negative Test Cases & Boundary Checks
1. **Negative Case: Đơn hàng thiếu mã khách hàng hoặc danh sách mặt hàng rỗng:**
   - *Input:* Gọi `submitOrder('', [...])` hoặc `submitOrder('CUST-1', [])`.
   - *Kỳ vọng:* Hệ thống ném lỗi xác thực (`Customer ID is required` hoặc `Order items cannot be empty`), ngăn chặn gửi lệnh rác lên Saga.
   - *Thực tế:* Test `should reject order submission with empty customerId or items` xác nhận ngoại lệ được ném ra chính xác.
2. **Negative Case: Trạng thái Pending bị treo vô hạn (Hanging Pending State):**
   - *Input:* Hạ tầng phân tán hoặc cổng thanh toán bị nghẽn khiến trạng thái mãi không chuyển CONFIRMED.
   - *Kỳ vọng:* Frontend không được hiển thị spinner vô tận làm người dùng chờ đợi trong hoang mang. Phải có giới hạn `maxPollAttempts`, tự động chuyển sang `TIMEOUT` để người dùng có hướng xử lý.
   - *Thực tế:* Test `should detect prolonged pending state and transition to TIMEOUT` kiểm chứng chuyển đổi `TIMEOUT` thành công.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: UI báo CONFIRMED trước khi Saga kết thúc (Optimistic UI Trap)
- **Hiểu lầm phổ biến:** Ngay khi nhấn nút "Đặt hàng", giao diện lập tức chuyển trạng thái sang "Thành công / Đã xác nhận" nhằm tạo cảm giác phản hồi nhanh (Optimistic Update).
- **Hậu quả nghiêm trọng:**
  1. *Lừa dối người dùng:* Trong kiến trúc phân tán hướng sự kiện (Choreography/Orchestration Saga), việc đặt hàng cần qua các bước kiểm tra tồn kho (Inventory) và trừ tiền (Payment). Nếu bước thanh toán thất bại hoặc hết hàng, giao diện đã báo thành công trước đó sẽ gây mất niềm tin và tranh chấp với khách hàng.
  2. *Bất đồng bộ giao dịch:* Khách hàng tin rằng họ đã mua được hàng và đóng trình duyệt, trong khi thực tế đơn hàng đã bị Saga bồi hoàn và hủy bỏ (`CANCELLED`).
- **Giải pháp chuẩn CommerceFlow:**
  - Ngay sau khi submit, UI chuyển sang `PENDING` ("Đang xử lý").
  - Kích hoạt polling định kỳ hoặc WebSocket/SSE để chờ kết quả xác thực cuối cùng từ Saga Orchestrator rồi mới chuyển `CONFIRMED`.

### 5.2. Thử thách độc lập: Kiểm thử Pending kéo dài (Prolonged Pending & Timeout Recovery)
- **Cách tiếp cận:**
  - Đặt cấu hình ngưỡng trần số lần thử `maxPollAttempts`.
  - Nếu số lần polling vượt ngưỡng mà server vẫn trả về `PENDING`, UI chủ động ngắt polling, cập nhật trạng thái đơn thành `TIMEOUT` kèm ghi chú giải thích trong lịch sử tiến trình (`statusHistory`).
  - Cung cấp nút liên hệ hỗ trợ hoặc tra cứu lại mã đơn thay vì để spinner quay vô tận.
