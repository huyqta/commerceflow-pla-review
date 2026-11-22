# Evidence CF-022 — Saga orchestration, compensation, eventual consistency

**Status:** `verified`  
**Milestone:** M4  
**Date:** 2026-11-22  
**Environment:**
- OS: Windows 11 (pwsh / PowerShell 7)
- Node.js: `v24.12.0`
- Revision Git SHA: `650a90e` (và các commit kế tiếp)

---

## 1. Mục tiêu và Bối cảnh Nghiệp vụ
Xây dựng bộ điều phối giao dịch phân tán **Saga Orchestrator**, luồng bồi hoàn (**Compensation Flow**), tính nhất quán cuối cùng (**Eventual Consistency**) và xử lý phục hồi sau sự cố Timeout (**Timeout Recovery**) cho chu trình đặt hàng của CommerceFlow:
- Hiện thực hóa đầy đủ các kịch bản:
  - **R-01 (Happy Path):** `PENDING` $\to$ `RESERVING_INVENTORY` $\to$ `CHARGING_PAYMENT` $\to$ `COMPLETED` (`orderStatus = CONFIRMED`).
  - **R-02 (Out of stock):** Không đủ tồn kho $\to$ `REJECTED`, tuyệt đối không kích hoạt cổng thanh toán.
  - **R-03 (Payment Failure):** Thanh toán bị từ chối $\to$ Kích hoạt bồi hoàn giải phóng kho $\to$ `CANCELLED`.
  - **R-04 (Duplicate Event Delivery):** Chống xử lý lặp lại bước Saga khi broker phát lặp sự kiện (`handleEvent` deduplication).
  - **R-05 & Timeout Recovery:** Tự động phát hiện và bồi hoàn các Saga bị treo ở bước thanh toán quá hạn (`recoverStaleSagas`).

---

## 2. Artifacts Tạo Mới & Chỉnh Sửa
1. `apps/order-service/src/application/order-saga.ts` — Module Saga Orchestration:
   - Các interfaces: `SagaState`, `SagaStep`, `InventoryClient`, `PaymentClient`.
   - Lớp `OrderSagaOrchestrator`: Quản lý State Machine tập trung, thực thi bù trừ khi gặp lỗi hoặc gateway timeout, và cơ chế phục hồi stale sagas.
2. `labs/CF-022/demo.mjs` — Micro-lab kiểm tra assertions bù trừ (`state === 'CANCELLED'`, `stockReserved === false`), sự tồn tại của artifact và các phương thức cốt lõi.
3. `labs/CF-022/saga-compensation.mjs` — Bài thực hành mô phỏng chuỗi sự kiện và bù trừ độc lập (`SAGA_COMPENSATION_DEMO_OK`).
4. `tests/order/order-saga.test.ts` — Bộ automated test suite với 6 tests kiểm tra R-01, R-02, R-03, Timeout Recovery, và Reactive Event Deduplication.

---

## 3. Lệnh Thực Thi & Kết Quả Xác Minh

### 3.1. Chạy Micro-lab CF-022
```powershell
node labs/CF-022/demo.mjs
```
**Output:**
```
[CF-022 Micro-Lab] Bắt đầu kiểm tra Saga Orchestration & Compensation Flow...
✔ Toàn bộ kiểm tra Saga Orchestration & Compensation CF-022 đều HỢP LỆ.
MICRO_LAB_OK CF-022
```
**Exit Code:** `0`

### 3.2. Chạy Mô phỏng Chuyên sâu Saga Compensation
```powershell
node labs/CF-022/saga-compensation.mjs
```
**Output:**
```
SAGA_COMPENSATION_DEMO_OK
```
**Exit Code:** `0`

### 3.3. Chạy Automated Tests cho Order Saga
```powershell
node --test tests/order/order-saga.test.ts
```
**Output:**
```
▶ 1. Kịch bản R-01 & R-02: Đơn hàng Thành công & Hết hàng
  ✔ R-01: Happy Path -> Giữ kho thành công, thu tiền thành công -> Saga COMPLETED, đơn CONFIRMED (0.9363ms)
  ✔ R-02: Out of Stock -> Không đủ hàng -> Saga REJECTED, đơn REJECTED, không gọi Payment (0.2788ms)
✔ 1. Kịch bản R-01 & R-02: Đơn hàng Thành công & Hết hàng (2.0203ms)
▶ 2. Kịch bản R-03: Thanh toán Lỗi & Saga Bồi hoàn (Compensation Flow)
  ✔ R-03: Payment thất bại -> Kích hoạt bồi hoàn giải phóng kho, đơn chuyển CANCELLED (0.338ms)
✔ 2. Kịch bản R-03: Thanh toán Lỗi & Saga Bồi hoàn (Compensation Flow) (0.4366ms)
▶ 3. Thử thách độc lập: Xử lý Gateway Timeout & Khôi phục Saga (Timeout Recovery)
  ✔ Thử thách độc lập: Payment Gateway bị Timeout -> Saga chuyển PAYMENT_TIMED_OUT, kích hoạt bồi hoàn kho (0.258ms)
  ✔ Stale Saga Recovery: Tự động phát hiện và bồi hoàn các Saga bị treo quá thời gian cho phép (26.1902ms)
✔ 3. Thử thách độc lập: Xử lý Gateway Timeout & Khôi phục Saga (Timeout Recovery) (26.7ms)
▶ 4. Kịch bản R-04 & Reactive Event Idempotency
  ✔ Chống xử lý lặp lại event từ Broker (Idempotent Event Handling) (16.0777ms)
✔ 4. Kịch bản R-04 & Reactive Event Idempotency (16.3992ms)
ℹ tests 6
ℹ suites 4
ℹ pass 6
ℹ fail 0
```
**Exit Code:** `0`

### 3.4. Chạy Hồi quy Toàn bộ Dự Án
```powershell
node --test tests/database/order-schema.test.ts tests/api/catalog-api.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/integration/order-api.spec.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts tests/messaging/event-bus.test.ts tests/messaging/outbox-inbox.test.ts tests/order/order-saga.test.ts
```
**Kết quả:** 104/104 tests pass 100% (Thời gian chạy: ~420ms).

---

## 4. Tình Huống Biên & Negative Test Cases

### Tình huống 1: Hết hàng $\to$ Chặn Gọi Cổng Thanh Toán (R-02 Invariant)
- **Kịch bản:** Khách hàng đặt 10 sản phẩm nhưng kho chỉ còn 1.
- **Hành vi:** `reserve` trả về thất bại. Orchestrator lập tức chuyển trạng thái sang `REJECTED`, `stockReserved = false`, và hoàn toàn **không kích hoạt** lệnh gọi tới `paymentClient.charge`.
- **Kết quả:** Đơn hàng bị từ chối sạch sẽ, không phát sinh giao dịch tiền tệ ảo.

### Tình huống 2: Payment Gateway Timeout $\to$ Tự động Kích hoạt Bồi hoàn (Timeout Handling)
- **Kịch bản:** Khi gọi trừ tiền thẻ, Payment Gateway bị timeout mạng (`TIMED_OUT`).
- **Hành vi:** Orchestrator không để đơn hàng bị treo `PENDING` vô tận mà chuyển sang `PAYMENT_TIMED_OUT`, kích hoạt gọi `inventoryClient.release` giải phóng hàng đã giữ, và cập nhật đơn hàng thành `CANCELLED`.
- **Kết quả:** Khách hàng không bị giữ hàng vô lý; tồn kho được hồi phục cho người mua khác.

### Tình huống 3: Stale Saga Recovery (Worker Khôi phục Saga bị treo)
- **Kịch bản:** Server xử lý thanh toán bị crash hoặc context bị gián đoạn khi đang chờ kết quả thanh toán.
- **Hành vi:** Hàm `recoverStaleSagas(maxAgeMs)` quét các saga có tuổi thọ vượt quá ngưỡng cấu hình và tự động thực hiện bồi hoàn an toàn.
- **Kết quả:** Phục hồi tính nhất quán cuối cùng của hệ thống.

---

## 5. Engineering Judgment & Phân tích Đánh đổi (Trade-off Analysis)

### Trade-off: Giả định Compensation có thể "Undo" mọi Side Effect vs. Thiết kế Nghiệp vụ Chấp nhận Thực tế
- **Giả định Compensation có thể hoàn tác 100% (Ảo tưởng kỹ thuật):**
  - Trong thực tế, không phải side-effect nào cũng có thể "hoàn tác" (Rollback) hoàn toàn như trong database ACID:
    - Tiền đã trừ qua cổng thanh toán thực tế không thể "undo" ngay tức khắc mà phải qua giao dịch Refund (mất phí giao dịch hoặc mất vài ngày làm việc).
    - Email xác nhận đã gửi tới khách hàng không thể "thu hồi" lại từ hộp thư của họ.
- **Giải pháp của CommerceFlow:**
  - Thiết kế thứ tự các bước trong Saga theo nguyên tắc: **Các bước có thể bồi hoàn dễ dàng thực hiện trước (Reserve/Release stock); các bước khó bồi hoàn hoặc phát sinh chi phí thực hiện sau (Charge payment)**.
  - Áp dụng bồi hoàn ngữ nghĩa (Semantic Compensation): Nhả khóa giữ chỗ tồn kho (Release reservation lock) và gửi thông báo đơn hàng bị hủy minh bạch tới khách hàng.

---

## 6. Lời giải Thử thách Độc lập (Independent Challenge Solution)

> **Câu hỏi:** Bổ sung payment timeout scenario? Giải thích trade-off và một test phát hiện lỗi.

### 1. Phân tích Kịch bản Payment Timeout:
- Trong môi trường phân tán (Cloud Run / Microservices), cổng thanh toán bên thứ ba (Stripe, VNPay, Paypal) có thể gặp lỗi nghẽn mạng hoặc quá tải dẫn đến Timeout.
- Nếu không có cơ chế Timeout Recovery:
  - Khách hàng bị treo màn hình không biết đơn hàng đã tạo hay chưa.
  - Số lượng hàng trong kho bị khóa giữ chỗ (`reserved_stock`) vĩnh viễn, làm mất cơ hội bán hàng.

### 2. Phép thử Thực tế Đã Chứng Minh (Verification Test):
- Trong test suite [`tests/order/order-saga.test.ts`](file:///e:/10_WORKS/AI_SKILL/commerceflow-pla-v1.2-review/commerceflow-pla-review/tests/order/order-saga.test.ts) (Suite 3: *Xử lý Gateway Timeout & Khôi phục Saga*):
  - Giả lập `paymentClient.charge` trả về `{ status: 'TIMED_OUT', reason: 'GATEWAY_TIMEOUT' }`.
  - Saga lập tức chuyển `currentStep` thành `PAYMENT_TIMED_OUT` $\to$ Tự động kích hoạt gọi `inventoryClient.release` $\to$ Cập nhật đơn hàng thành `CANCELLED`.
  - Giả lập trường hợp tiến trình thanh toán bị treo vô hạn: Hàm `recoverStaleSagas` phát hiện và bồi hoàn thành công (`recovered === 1`, `orderStatus === 'CANCELLED'`).
