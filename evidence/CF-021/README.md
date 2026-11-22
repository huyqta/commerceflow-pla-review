# Evidence CF-021 — Transactional Outbox/Inbox, idempotent consumers

**Status:** `verified`  
**Milestone:** M4  
**Date:** 2026-11-22  
**Environment:**
- OS: Windows 11 (pwsh / PowerShell 7)
- Node.js: `v24.12.0`
- Revision Git SHA: `650a90e` (và các commit kế tiếp)

---

## 1. Mục tiêu và Bối cảnh Nghiệp vụ
Triển khai mẫu thiết kế **Transactional Outbox / Inbox Pattern** và **Idempotent Consumers** cho hệ thống CommerceFlow:
- Triệt tiêu hoàn toàn rủi ro **Dual-write** giữa Database cục bộ và Message Broker.
- Đảm bảo tính nguyên tử (**Transactional Atomicity**): Trạng thái đơn hàng (Order State) và bản ghi sự kiện (`OutboxRecord`) bắt buộc phải được commit cùng nhau trong 1 database transaction duy nhất.
- Xây dựng **Outbox Publisher Worker**: Polling định kỳ các bản ghi `PENDING`, gửi qua `IEventBus`, xử lý retry khi broker gặp sự cố tạm thời, và đánh dấu `PUBLISHED`.
- Triển khai **Idempotent Consumer (Inbox Pattern)**: Chống trùng lặp xử lý (Deduplication) khi Broker áp dụng At-Least-Once Delivery theo kịch bản **R-04**.

---

## 2. Artifacts Tạo Mới & Chỉnh Sửa
1. `apps/order-service/src/infrastructure/outbox-publisher.ts` — Module Transactional Outbox & Inbox Worker:
   - `InMemoryTransactionalStore`: Quản lý transaction boundary cục bộ (mô phỏng commit/rollback atomic giữa Order và Outbox).
   - `OutboxPublisherWorker`: Worker quét sự kiện chưa gửi, publish sang broker, hỗ trợ retry.
   - `IdempotentConsumer`: Wrapper kiểm tra `inbox_events` theo `(message_id, consumer_name)`, bảo đảm side effect chỉ thực thi đúng 1 lần.
2. `labs/CF-021/demo.mjs` — Micro-lab kiểm tra assertions deduplication (`sideEffects === 1`), sự tồn tại của artifact và các class cốt lõi.
3. `labs/CF-021/outbox-inbox-simulation.mjs` — Bài thực hành mô phỏng Outbox/Inbox chạy độc lập thành công (`OUTBOX_INBOX_DEMO_OK`).
4. `tests/messaging/outbox-inbox.test.ts` — Bộ automated test suite với 6 tests kiểm tra Transactional Atomicity, Rollback khi Outbox lỗi, Worker retry, và Inbox Deduplication.

---

## 3. Lệnh Thực Thi & Kết Quả Xác Minh

### 3.1. Chạy Micro-lab CF-021
```powershell
node labs/CF-021/demo.mjs
```
**Output:**
```
[CF-021 Micro-Lab] Bắt đầu kiểm tra Transactional Outbox & Idempotent Consumers...
✔ Toàn bộ kiểm tra Transactional Outbox/Inbox CF-021 đều HỢP LỆ.
MICRO_LAB_OK CF-021
```
**Exit Code:** `0`

### 3.2. Chạy Mô phỏng Chuyên sâu Outbox/Inbox
```powershell
node labs/CF-021/outbox-inbox-simulation.mjs
```
**Output:**
```
OUTBOX_INBOX_DEMO_OK
```
**Exit Code:** `0`

### 3.3. Chạy Automated Tests cho Outbox/Inbox
```powershell
node --test tests/messaging/outbox-inbox.test.ts
```
**Output:**
```
▶ 1. Transactional Atomicity (Loại bỏ Dual-Write Anti-pattern)
  ✔ Transaction thành công: Ghi đồng thời trạng thái Order và OutboxRecord vào cùng 1 transaction boundary (0.9013ms)
  ✔ Transaction Rollback: Khi ghi Outbox gặp lỗi (ví dụ duplicate event ID), toàn bộ Order cũng bị hủy bỏ (0 Orphan Records) (0.6796ms)
✔ 1. Transactional Atomicity (Loại bỏ Dual-Write Anti-pattern) (2.4204ms)
▶ 2. Outbox Publisher Worker (At-least-once Delivery & Exponential Retry)
  ✔ Worker quét các bản ghi PENDING, publish lên broker và cập nhật status = PUBLISHED (1.9518ms)
  ✔ Worker retry khi Broker gặp lỗi tạm thời (Network / Broker Down) (0.3261ms)
✔ 2. Outbox Publisher Worker (At-least-once Delivery & Exponential Retry) (2.4679ms)
▶ 3. Idempotent Consumer & Inbox Deduplication (Kịch bản R-04 & Thử thách độc lập)
  ✔ Thử thách độc lập: Thử publish 2 lần cùng eventId -> Inbox Deduplication chặn side effect lần 2 (0.4285ms)
  ✔ Nhiều Consumers khác nhau cùng xử lý 1 eventId mà không bị xung đột inbox (0.3206ms)
✔ 3. Idempotent Consumer & Inbox Deduplication (Kịch bản R-04 & Thử thách độc lập) (0.8969ms)
ℹ tests 6
ℹ suites 3
ℹ pass 6
ℹ fail 0
```
**Exit Code:** `0`

### 3.4. Chạy Hồi quy Toàn bộ Dự Án
```powershell
node --test tests/database/order-schema.test.ts tests/api/catalog-api.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/integration/order-api.spec.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts tests/messaging/event-bus.test.ts tests/messaging/outbox-inbox.test.ts
```
**Kết quả:** 98/98 tests pass 100% (Thời gian chạy: ~400ms).

---

## 4. Tình Huống Biên & Negative Test Cases

### Tình huống 1: Lỗi Ghi Outbox $\to$ Rollback Hoàn Toàn Order State (Atomicity Check)
- **Kịch bản:** Database ghi Order thành công, nhưng bước ghi Outbox gặp lỗi (ví dụ: vi phạm unique constraint trên `id`).
- **Hành vi:** Hàm `executeTransaction` bắt lỗi và thực hiện Rollback toàn bộ state.
- **Kết quả:** Bảng `orders` không chứa bản ghi mồ côi (0 Orphan Records). Đảm bảo không xảy ra tình trạng "đơn hàng đã lưu nhưng event không bao giờ được phát ra".

### Tình huống 2: Broker Downtime $\to$ Outbox Worker Retry
- **Kịch bản:** Khi Outbox Worker cố gắng publish sự kiện lên Message Broker nhưng broker bị mất kết nối mạng (`NETWORK_TIMEOUT`).
- **Hành vi:** Worker đánh dấu `status = 'FAILED'`, tăng `retryCount += 1`, lưu `lastError`, và giữ nguyên bản ghi trong outbox để retry trong chu kỳ quét kế tiếp.
- **Kết quả:** Không có sự kiện nào bị mất (Zero Message Loss).

### Tình huống 3: At-Least-Once Duplicate Delivery $\to$ Inbox Deduplication
- **Kịch bản:** Do cơ chế retry của broker, cùng 1 `eventId` được gửi 2 lần tới Inventory Service.
- **Hành vi:** Consumer kiểm tra bảng `inbox_events`. Lần 1 trả về `APPLIED` và trừ tồn kho; lần 2 phát hiện `messageId` đã tồn tại, trả về `DUPLICATE_SKIPPED` và bỏ qua.
- **Kết quả:** Tồn kho không bị trừ lần 2 (Bảo vệ tuyệt đối invariant nghiệp vụ của kịch bản R-04).

---

## 5. Engineering Judgment & Phân tích Đánh đổi (Trade-off Analysis)

### Trade-off: Dual-write giữa Database và Broker vs. Transactional Outbox Pattern
- **Dual-write (Anti-pattern nguy hiểm):**
  - Thực hiện ghi database: `await db.orders.insert(...)` sau đó gọi trực tiếp `await broker.publish(...)`.
  - *Rủi ro nghiêm trọng:* Nếu server crash ngay sau khi ghi DB hoặc broker gặp lỗi mạng, event bị mất vĩnh viễn $\to$ Đơn hàng ở trạng thái `PENDING` vô tận mà không có service nào tiếp tục xử lý. Ngược lại, nếu publish broker trước rồi ghi DB sau, khi DB lỗi thì broker đã phát event sai $\to$ Ghost Orders.
- **Transactional Outbox (Giải pháp của CommerceFlow):**
  - Ghi bản ghi sự kiện vào bảng `outbox_events` ngay trong cùng ACID transaction của Order.
  - Một tiến trình nền (Outbox Worker) độc lập đọc từ `outbox_events` và publish lên broker với cơ chế retry.
  - *Đánh đổi:* Chấp nhận độ trễ nhỏ (Eventual Consistency) để đổi lấy tính toàn vẹn dữ liệu tuyệt đối (Guaranteed Delivery).

---

## 6. Lời giải Thử thách Độc lập (Independent Challenge Solution)

> **Câu hỏi:** Thử publish 2 lần cùng eventId? Giải thích trade-off và một test phát hiện lỗi.

### 1. Phân tích Hiện tượng:
- Khi Outbox Publisher gặp timeout mạng ở bước nhận ACK từ broker, nó sẽ gửi lại sự kiện. Hậu quả là cùng một `eventId` sẽ đến consumer nhiều lần (Duplicate Messages).
- Để giải quyết, Consumer bắt buộc phải áp dụng **Inbox Pattern**:
  - Lưu cặp `(message_id, consumer_name)` vào bảng `inbox_events` với ràng buộc `UNIQUE`.
  - Thao tác xử lý nghiệp vụ và ghi inbox được thực hiện trong cùng một local transaction.

### 2. Phép thử Thực tế Đã Chứng Minh (Verification Test):
- Trong test suite [`tests/messaging/outbox-inbox.test.ts`](file:///e:/10_WORKS/AI_SKILL/commerceflow-pla-v1.2-review/commerceflow-pla-review/tests/messaging/outbox-inbox.test.ts) (Suite 3, Test 1):
  - Khởi tạo `IdempotentConsumer` cho Inventory Service.
  - Gửi event `evt-order-dup-777` lần 1 $\to$ Trả về `status: APPLIED`, trừ 2 tồn kho.
  - Gửi lại chính xác `evt-order-dup-777` lần 2 và lần 3 $\to$ Đều trả về `status: DUPLICATE_SKIPPED`.
  - Assert kiểm chứng: Số lượng tồn kho bị trừ vẫn chính xác là 2 (không bị tăng lên 4 hay 6).
