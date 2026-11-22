# Evidence CF-023: Resilience, retries, dead-letter và failure injection

## 1. Thông tin tổng quan
- **Issue ID:** CF-023
- **Milestone:** M4 (Distributed Architecture & Event-Driven Migration)
- **Loại:** `review`
- **Mục tiêu:** Thiết kế retry bounded, backoff và dead-letter replay. Phân biệt Transient vs Permanent Error, chống bão retry storm và xử lý Poison Pills.
- **Môi trường:** Node.js v24.12.0 trên Windows 11.
- **Thời gian thực hiện:** 2026-11-22.

---

## 2. Artifacts & Deliverables đã tạo
1. `tests/faults/retry-scenarios.md`:
   - Đặc tả kiến trúc Resilience, Bounded Exponential Backoff + Jitter.
   - Nguyên tắc phân loại Transient vs Permanent Errors.
   - Cơ chế Dead-Letter Queue (DLQ) & Dead-Letter Replay pattern.
   - 4 kịch bản Failure Injection (Network Timeout, Poison Pill Payload, Transient 503, Dead-Letter Replay).
2. `packages/messaging/src/resilience.ts`:
   - Hàm `classifyError(err)`: phân loại lỗi chính xác dựa trên status code, error code và thông điệp.
   - Hàm `calculateBackoff(attempt, config)`: tính toán thời gian chờ tăng theo hàm mũ và giới hạn `maxDelayMs`.
   - Lớp `DeadLetterQueueStore`: lưu trữ các bản ghi thất bại, quản lý trạng thái (`PENDING_REVIEW`, `REPLAYED`, `DISCARDED`).
   - Lớp `ResilientConsumerRunner`: bọc handler thực thi với chính sách retry thông minh, ngắt retry ngay khi gặp permanent error hoặc vượt ngưỡng `maxAttempts`, và hỗ trợ `replayMessage`.
3. `tests/messaging/resilience-retry.test.ts`:
   - Bộ 6 automated tests bao phủ toàn diện: tính toán backoff, phân loại lỗi, xử lý transient error thành công sau retry, định tuyến poison pill vào DLQ ngay lượt đầu, đẩy vào DLQ khi hết số lượt retry, và replay sự kiện từ DLQ vào EventBus.
4. `labs/CF-023/demo.mjs`:
   - Micro-lab độc lập kiểm tra assertion backoff: `[100, 200, 400]`.

---

## 3. Nhật ký kiểm thử & Thực thi lệnh

### 3.1. Chạy Micro-lab
```bash
node labs/CF-023/demo.mjs
```
- **Exit Code:** 0
- **Output:**
```
MICRO_LAB_OK CF-023
```

### 3.2. Chạy Automated Unit Tests CF-023
```bash
node --experimental-strip-types --test tests/messaging/resilience-retry.test.ts
```
- **Exit Code:** 0
- **Output:**
```
▶ CF-023: Resilience, Retries and Dead-Letter Queue
  ✔ should calculate exponential backoff with upper bound correctly (2.1433ms)
  ✔ should classify transient and permanent errors accurately (0.4362ms)
  ✔ should successfully process message after transient retries (44.0612ms)
  ✔ should immediately route poison pill (permanent error) to DLQ without retries (0.5686ms)
  ✔ should route transient error to DLQ once maxAttempts limit is exhausted (44.3972ms)
  ✔ should support dead-letter replay back into event bus (1.1249ms)
✔ CF-023: Resilience, Retries and Dead-Letter Queue (94.2162ms)
ℹ tests 6
ℹ suites 1
ℹ pass 6
ℹ fail 0
```

### 3.3. Chạy Toàn bộ Test Suite Hồi quy (111 tests pass)
```bash
node --experimental-strip-types --test tests/architecture/order-boundary.test.ts tests/database/order-schema.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/api/catalog-api.test.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts tests/messaging/event-bus.test.ts tests/messaging/outbox-inbox.test.ts tests/order/order-saga.test.ts tests/messaging/resilience-retry.test.ts
```
- **Exit Code:** 0
- **Kết quả:** 111 tests passed, 0 failures.

---

## 4. Negative Test Cases & Boundary Checks
1. **Negative Case: Poison Pill (Malformed Payload / Validation Error):**
   - *Input:* Event chứa cấu trúc không khớp Schema (`POISON_PILL: schema validation failed`, code `VALIDATION_ERROR`).
   - *Kỳ vọng:* Consumer runner KHÔNG retry thêm bất kỳ lần nào (`attempts = 1`), ngắt ngay lập tức và đẩy bản ghi vào DLQ với phân loại `PERMANENT`.
   - *Thực tế:* Test `should immediately route poison pill (permanent error) to DLQ without retries` xác nhận handler chỉ chạy đúng 1 lần, DLQ nhận bản ghi với trạng thái `PENDING_REVIEW`.
2. **Negative Case: Transient Error vượt quá giới hạn Bounded Retry (`maxAttempts`):**
   - *Input:* Lỗi `503 Service Unavailable` kéo dài vượt quá `maxAttempts = 3`.
   - *Kỳ vọng:* Sau khi thực hiện đủ 3 attempts và đạt trần backoff, runner dừng retry và đưa thông điệp vào DLQ với phân loại `TRANSIENT` để người vận hành kiểm tra sau, tránh vòng lặp retry vô tận làm kiệt quệ tài nguyên.
   - *Thực tế:* Test `should route transient error to DLQ once maxAttempts limit is exhausted` xác nhận dừng ở 3 attempts và chuyển vào DLQ.
3. **Negative Case: Replay không thành công khi bản ghi không tồn tại hoặc đã được Replay:**
   - *Input:* Gọi `replayMessage` với ID không hợp lệ hoặc bản ghi đã có status `REPLAYED`.
   - *Kỳ vọng:* Hàm trả về `false`, không phát lại sự kiện trùng lặp lên EventBus.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Retry non-idempotent request vô hạn (Infinite Retry Anti-Pattern)
- **Hiểu lầm phổ biến:** Càng retry nhiều thì tỷ lệ thành công càng cao, do đó nhiều hệ thống cấu hình retry vô hạn hoặc không chặn số lần thử.
- **Rủi ro thực tế:**
  1. *Retry Storm (Bão yêu cầu):* Khi một downstream service (ví dụ Payment Gateway hoặc Database) đang bị nghẽn hoặc sập, hàng nghìn client/consumer đồng loạt retry liên tục sẽ tạo ra tải cấp số nhân, khiến downstream không bao giờ phục hồi được (Thundering Herd Problem).
  2. *Duplicate Side Effects:* Nếu request là non-idempotent (ví dụ trừ tiền tài khoản hoặc tạo hóa đơn), việc retry mù quáng mà không có Idempotency-Key sẽ dẫn đến việc trừ tiền khách hàng nhiều lần.
  3. *Treo hàng đợi (Head-of-Line Blocking):* Một thông điệp lỗi độc hại (Poison Pill) nằm ở đầu queue và bị retry vô tận sẽ khóa chặt worker, làm tắc nghẽn hàng triệu thông điệp hợp lệ phía sau.
- **Giải pháp chuẩn:**
  - Bắt buộc áp dụng **Bounded Retries** (ví dụ tối đa 3-5 lần).
  - Kết hợp **Exponential Backoff with Full Jitter** để phân tán thời điểm gửi lại của các worker.
  - Phân loại lỗi: chỉ retry lỗi tạm thời (**Transient**), tuyệt đối không retry lỗi cấu trúc/nghiệp vụ (**Permanent**).
  - Có cơ chế **Dead-Letter Queue (DLQ)** để hứng các thông điệp cạn lượt retry.

### 5.2. Thử thách độc lập: Phân biệt Transient và Permanent Error (Poison Pill)
- **Bản chất khác biệt:**
  - **Transient Error (Lỗi tạm thời):** Lỗi phát sinh do hạ tầng hoặc môi trường tạm thời không khả dụng, ví dụ rớt gói mạng (`ECONNRESET`, `ETIMEDOUT`), service bị nghẽn tải tạm thời (`503 Service Unavailable`, `429 Too Many Requests`), deadlock cơ sở dữ liệu tạm thời. *Đặc điểm: Cùng một request nếu gửi lại sau vài giây có thể thành công hoàn toàn.*
  - **Permanent Error (Lỗi vĩnh viễn / Poison Pill):** Lỗi phát sinh từ bản thân nội dung hoặc logic của thông điệp, ví dụ cú pháp JSON sai, vi phạm Schema/Contract (`400 Bad Request`, `422 Unprocessable Entity`), thiếu quyền hạn (`401`, `403`), hoặc vi phạm bất biến nghiệp vụ. *Đặc điểm: Cùng một request có gửi lại 1 triệu lần cũng sẽ thất bại y hệt 1 triệu lần.*
- **Phép thử chứng minh trong code & test:**
  - Trong `tests/messaging/resilience-retry.test.ts`:
    - Với `TransientError`, runner cho phép lặp lại 3 lần qua các mốc thời gian tăng dần và hoàn tất thành công khi hạ tầng hồi phục.
    - Với `PermanentPoisonPillError`, `classifyError` ngay lập tức trả về `PERMANENT`, `ResilientConsumerRunner` ngắt vòng lặp retry ngay tại `attempt = 1` và chuyển thẳng vào DLQ. Chứng minh không lãng phí CPU hay gây nghẽn worker.
