# Evidence CF-020 — Event bus abstraction và Pub/Sub adapter

**Status:** `verified`  
**Milestone:** M4  
**Date:** 2026-11-22  
**Environment:**
- OS: Windows 11 (pwsh / PowerShell 7)
- Node.js: `v24.12.0`
- Revision Git SHA: `650a90e` (và các commit kế tiếp)

---

## 1. Mục tiêu và Bối cảnh Nghiệp vụ
Xây dựng tầng trừu tượng Event Bus (Event Bus Abstraction) và các Adapter Pub/Sub phục vụ kiến trúc hướng sự kiện (Event-Driven Architecture) trong CommerceFlow:
- Định nghĩa interface `IEventBus` chuẩn cho các thao tác `publish`, `subscribe`, `close`.
- Chuẩn hóa thông điệp qua `EventEnvelope` với siêu dữ liệu truy vết phân tán (`eventId`, `correlationId`, `causationId`, `source`, `timestamp`).
- Cài đặt `InMemoryEventBus` cho môi trường local testing / micro-lab: Hỗ trợ Fan-out, Unsubscribe và phương thức mô phỏng phân phối lặp lại (`simulateDuplicateDelivery`).
- Cài đặt đặc tả `GcpPubSubAdapter` cho Google Cloud Pub/Sub trên môi trường Cloud Run (chuẩn bị cho các lab cloud tiếp theo, không tạo tài nguyên cloud thật lúc test).
- Đáp ứng kịch bản **R-04**: At-Least-Once Delivery & Idempotent Consumer (chống xử lý lặp lại).

---

## 2. Artifacts Tạo Mới & Chỉnh Sửa
1. `packages/messaging/src/event-bus.ts` — Module Event Bus Abstraction & Adapters:
   - Interfaces: `IEventBus`, `EventEnvelope`, `EventHandler`, `Subscription`.
   - Classes: `InMemoryEventBus`, `GcpPubSubAdapter`, `MessagingError`.
2. `labs/CF-020/demo.mjs` — Micro-lab kiểm tra assertions độc lập: publish message (`published.length === 1`), sự tồn tại của artifact và các interfaces, envelope correlationId.
3. `tests/messaging/event-bus.test.ts` — Bộ automated test suite với 9 tests kiểm tra Publish/Subscribe, Fan-out, Unsubscribe, Distributed Tracing, R-04 Idempotency, GCP Pub/Sub Spec, và Negative cases.

---

## 3. Lệnh Thực Thi & Kết Quả Xác Minh

### 3.1. Chạy Micro-lab CF-020
```powershell
node labs/CF-020/demo.mjs
```
**Output:**
```
[CF-020 Micro-Lab] Bắt đầu kiểm tra Event Bus Abstraction & Pub/Sub Adapter...
✔ Toàn bộ kiểm tra Event Bus Abstraction CF-020 đều HỢP LỆ.
MICRO_LAB_OK CF-020
```
**Exit Code:** `0`

### 3.2. Chạy Automated Tests cho Event Bus
```powershell
node --test tests/messaging/event-bus.test.ts
```
**Output:**
```
▶ 1. In-Memory Event Bus Publish & Subscribe (Local Adapter)
  ✔ Publish một event và Subscriber nhận đúng dữ liệu Envelope (2.3362ms)
  ✔ Fan-out: Nhiều subscribers trên cùng 1 topic đều nhận được event (0.3603ms)
  ✔ Unsubscribe: Sau khi hủy đăng ký, subscriber không còn nhận sự kiện mới (0.3111ms)
✔ 1. In-Memory Event Bus Publish & Subscribe (Local Adapter) (3.8209ms)
▶ 2. Thử thách độc lập: Truy vết Phân tán (Distributed Tracing với eventId & correlationId)
  ✔ Thử thách độc lập: correlationId được bảo toàn xuyên suốt chuỗi Order -> Inventory -> Payment (0.4373ms)
  ✔ Tự động tạo correlationId mặc định nếu publisher không cung cấp (0.3988ms)
✔ 2. Thử thách độc lập: Truy vết Phân tán (Distributed Tracing với eventId & correlationId) (0.9757ms)
▶ 3. Kịch bản R-04: At-least-once Delivery & Chống Duplicate Processing (Idempotent Consumer)
  ✔ Kịch bản R-04: Khi Broker gửi trùng lặp 1 eventId 2 lần, Idempotent Consumer chỉ thực thi side effect 1 lần duy nhất (0.3703ms)
✔ 3. Kịch bản R-04: At-least-once Delivery & Chống Duplicate Processing (Idempotent Consumer) (0.5052ms)
▶ 4. GCP Cloud Pub/Sub Adapter (Spec & Negative Cases)
  ✔ GcpPubSubAdapter serialize payload và đính kèm đầy đủ Pub/Sub attributes (0.3107ms)
  ✔ Negative Case: Từ chối publish khi topic rỗng hoặc eventId không hợp lệ (0.5199ms)
  ✔ Negative Case: Từ chối publish/subscribe sau khi EventBus đã đóng (close) (0.1776ms)
✔ 4. GCP Cloud Pub/Sub Adapter (Spec & Negative Cases) (1.1736ms)
ℹ tests 9
ℹ suites 4
ℹ pass 9
ℹ fail 0
```
**Exit Code:** `0`

### 3.3. Chạy Hồi quy Toàn bộ Dự Án
```powershell
node --test tests/database/order-schema.test.ts tests/api/catalog-api.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/integration/order-api.spec.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts tests/messaging/event-bus.test.ts
```
**Kết quả:** 92/92 tests pass 100% (Thời gian chạy: ~420ms).

---

## 4. Tình Huống Biên & Negative Test Cases

### Tình huống 1: Kịch bản R-04 — At-least-once Delivery & Duplicate Message
- **Kịch bản:** Broker gửi lại thông điệp 2 lần do mạng chập chờn hoặc timeout (`simulateDuplicateDelivery`).
- **Hành vi:** Consumer lưu trữ `processedEventIds` (Inbox Pattern). Lần 1 xử lý nghiệp vụ; lần 2 phát hiện `eventId` đã tồn tại và bỏ qua an toàn mà không sinh side effect.
- **Kết quả:** `sideEffectExecutionCount === 1`.

### Tình huống 2: Topic rỗng hoặc Event không có EventId
- **Kịch bản:** Service gọi `bus.publish('', ...)` hoặc `bus.publish('topic', { eventId: '' })`.
- **Hành vi:** `InMemoryEventBus` ném ra `MessagingError` với code `INVALID_TOPIC` hoặc `INVALID_EVENT`.

### Tình huống 3: Publish/Subscribe sau khi Bus đã đóng (Lifecycle Error)
- **Kịch bản:** Service cố gắng publish event khi hệ thống đang trong giai đoạn Graceful Shutdown (`bus.close()`).
- **Hành vi:** Bị từ chối ngay lập tức với lỗi `BUS_ALREADY_CLOSED`.

---

## 5. Engineering Judgment & Phân tích Đánh đổi (Trade-off Analysis)

### Trade-off: Giả định Exactly-once Delivery (Anti-pattern) vs. Chấp nhận At-least-once Delivery kèm Idempotent Consumers
- **Giả định Exactly-once Delivery (Ảo tưởng kỹ thuật):**
  - Trong hệ thống mạng phân tán (theo định lý FLP và Two Generals Problem), không một message broker nào có thể đảm bảo 100% exactly-once delivery mà không phải trả giá bằng độ trễ cực lớn hoặc phân mảnh giao dịch 2PC (Two-Phase Commit).
  - Nếu thiết kế consumer giả định thông điệp chỉ đến 1 lần duy nhất, khi xảy ra retry do network timeout, hệ thống sẽ gặp lỗi nghiêm trọng: **Trừ tiền 2 lần (Double Charge)** hoặc **Trừ kho 2 lần (Double Reservation)**.
- **Chấp nhận At-least-once Delivery (Lựa chọn của CommerceFlow):**
  - Message Broker đảm bảo thông điệp sẽ được gửi ít nhất 1 lần (`at-least-once`).
  - Trách nhiệm bảo đảm tính chính xác thuộc về Consumer thông qua **Inbox Pattern** và **Idempotency Key**: Bỏ qua các sự kiện trùng lặp dựa trên `eventId` đã được ghi nhận.

---

## 6. Lời giải Thử thách Độc lập (Independent Challenge Solution)

> **Câu hỏi:** Thêm eventId và correlationId? Giải thích trade-off và một test phát hiện lỗi.

### 1. Vai trò của `eventId`, `correlationId`, và `causationId`:
- **`eventId` (Khóa định danh sự kiện):** Là UUID duy nhất của chính bản ghi sự kiện đó. Dùng cho việc chống xử lý lặp lại (Deduplication / Idempotent Consumer).
- **`correlationId` (Mã phiên giao dịch phân tán):** Được sinh ra tại điểm bắt đầu của chuỗi nghiệp vụ (ví dụ: khi nhận request `POST /api/v1/orders`). Mã này được truyền liên tục xuyên suốt qua tất cả các event giữa các dịch vụ: `OrderCreated -> InventoryReserved -> PaymentSucceeded -> OrderConfirmed`. Cho phép Log Aggregator (GCP Cloud Logging) gom cụm toàn bộ nhật ký của 1 đơn hàng qua 1 truy vấn duy nhất.
- **`causationId` (Mã nguyên nhân):** Là `eventId` của sự kiện hoặc lệnh trực tiếp kích hoạt ra sự kiện hiện tại, giúp vẽ cây quan hệ nhân quả (Causality Graph).

### 2. Phép thử Thực tế Đã Chứng Minh (Verification Test):
- Trong test suite [`tests/messaging/event-bus.test.ts`](file:///e:/10_WORKS/AI_SKILL/commerceflow-pla-v1.2-review/commerceflow-pla-review/tests/messaging/event-bus.test.ts) (Suite 2: *Truy vết Phân tán*):
  - Kích hoạt chuỗi: `OrderCreated` $\to$ `InventoryReserved` $\to$ `PaymentService`.
  - Kiểm chứng: Cả Inventory Service và Payment Service đều ghi nhận chính xác cùng một `correlationId` (`corr-tx-abc-123`).
  - Kiểm chứng `causationId`: Event `InventoryReserved` ghi nhận đúng `causationId = evt-ord-101`.
  - **Kết luận:** Hệ thống bảo toàn tính liên tục của chuỗi truy vết phân tán mà không bị đứt gãy.
