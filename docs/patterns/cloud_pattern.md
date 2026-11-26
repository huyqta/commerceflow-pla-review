# Tổng Hợp Cloud & Distributed Design Patterns Trong Dự Án CommerceFlow

Tài liệu này hệ thống hóa toàn bộ các **Cloud Design Patterns** và **Kiến trúc Hệ phân tán** được hiện thực hóa trong dự án **CommerceFlow**, đóng vai trò làm tài liệu tham chiếu và cẩm nang đào tạo cho các lập trình viên.

---

## Mục Lục
1. [Transactional Outbox & Inbox Pattern](#1-transactional-outbox--inbox-pattern)
2. [Saga Pattern (Orchestration with Compensating Transactions)](#2-saga-pattern-orchestration-with-compensating-transactions)
3. [Database per Service (Logical Schema Isolation)](#3-database-per-service-logical-schema-isolation)
4. [API Gateway Pattern](#4-api-gateway-pattern)
5. [Retry with Exponential Backoff, Jitter & Dead-Letter Queue (DLQ)](#5-retry-with-exponential-backoff-jitter--dead-letter-queue-dlq)
6. [Health Endpoint Monitoring Pattern (Liveness & Readiness Probes)](#6-health-endpoint-monitoring-pattern-liveness--readiness-probes)
7. [Distributed Tracing & Correlation Identifier](#7-distributed-tracing--correlation-identifier)
8. [Scale-to-Zero & Cloud Cost Optimization Pattern](#8-scale-to-zero--cloud-cost-optimization-pattern)

---

## 1. Transactional Outbox & Inbox Pattern

### Vị trí triển khai
- [apps/order-service/src/infrastructure/outbox-publisher.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/infrastructure/outbox-publisher.ts)
- [apps/order-service/src/infrastructure/postgres-order.repository.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/infrastructure/postgres-order.repository.ts#L79-L91)
- [docs/adr/ADR-003.md](file:///Users/huy/projects-h/commerceflow-pla-review/docs/adr/ADR-003.md)

### Như thế nào (Cách thức hiện thực)
- **Outbox Table:** Khi đơn hàng được tạo hoặc cập nhật, thay vì bắn trực tiếp sự kiện lên Message Broker (Pub/Sub), bản ghi sự kiện được lưu vào bảng `outbox_events` trong **cùng 1 Local Transaction ACID** với bảng `orders`.
- **Outbox Worker (Relay):** Một tiến trình nền định kỳ quét các bản ghi có trạng thái `PENDING` hoặc `FAILED` (với số lần retry < 5) trong bảng `outbox_events`, đóng gói và xuất bản lên Google Cloud Pub/Sub. Khi broker xác nhận (ACK), trạng thái chuyển sang `PUBLISHED`.
- **Inbox Table (Idempotent Consumer):** Phía Service nhận (Consumer), trước khi xử lý message, tiến hành ghi `message_id` vào bảng `inbox_events` có ràng buộc `UNIQUE (message_id, consumer_name)`. Nếu đã tồn tại, bỏ qua ngay mà không xử lý lại.

### Vấn đề giải quyết
- **Triệt tiêu Dual-Write Hazard:** Trong hệ thống phân tán, việc vừa ghi vào Database vừa gửi message lên Broker không thể bọc trong một distributed transaction (2PC). Một trong hai thao tác có thể thất bại gây lệch dữ liệu (ví dụ: tạo đơn thành công nhưng kho không nhận được tin nhắn để giữ hàng).
- **Đảm bảo At-Least-Once Delivery & Idempotency:** Broker có thể gửi lặp tin nhắn (duplicate delivery) do network timeout; Inbox pattern đảm bảo consumer xử lý an toàn không bị trừ kho 2 lần.

### Ưu nhược điểm & Lưu ý
- **Ưu điểm:** Đảm bảo 100% tính nguyên tử giữa Database và Message Broker; giải quyết bất đồng bộ bền vững.
- **Nhược điểm:** Tăng độ trễ nhẹ (latency từ lúc ghi outbox đến khi worker quét và publish); bảng outbox/inbox tăng nhanh về kích thước.
- **Lưu ý thực tế:** Cần thiết lập Partitioning theo ngày và Job dọn dẹp (Housekeeping/Purge job) định kỳ xóa các bản ghi `PUBLISHED` quá 7 hoặc 30 ngày.

---

## 2. Saga Pattern (Orchestration with Compensating Transactions)

### Vị trí triển khai
- [apps/order-service/src/application/order-saga.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/application/order-saga.ts)
- [docs/adr/ADR-003.md](file:///Users/huy/projects-h/commerceflow-pla-review/docs/adr/ADR-003.md)
- [labs/CF-022/saga-compensation.mjs](file:///Users/huy/projects-h/commerceflow-pla-review/labs/CF-022/saga-compensation.mjs)

### Như thế nào (Cách thức hiện thực)
- Lớp `OrderSagaOrchestrator` hoạt động như một máy trạng thái (State Machine) điều phối giao dịch phân tán qua 3 bước:
  1. `RESERVING_INVENTORY`: Gọi Inventory Service giữ hàng.
  2. `CHARGING_PAYMENT`: Nếu giữ hàng thành công, tiến hành trừ tiền qua Payment Gateway.
  3. `CONFIRMED`: Nếu thanh toán thành công, hoàn tất đơn hàng.
- **Giao dịch bù trừ (Compensating Transaction):** Nếu bước thanh toán trả về `FAILED` hoặc `TIMED_OUT`, Orchestrator lập tức gọi `inventoryClient.release()` để giải phóng số lượng hàng đã giữ trước đó, sau đó đánh dấu đơn hàng là `CANCELLED`.
- **Phục hồi treo (Timeout Recovery):** Quét định kỳ các Saga instance ở trạng thái chờ quá lâu để tự động kích hoạt bồi hoàn.

### Vấn đề giải quyết
- Xử lý các giao dịch kinh doanh kéo dài qua nhiều microservices độc lập (Long-Running Transactions) mà không thể dùng khóa phân tán (Distributed Lock) hoặc Two-Phase Commit (2PC).

### Ưu nhược điểm & Lưu ý
- **Ưu điểm:** Luồng điều phối tập trung (Orchestration) giúp dễ theo dõi tiến trình, dễ debug, dễ viết test kịch bản bồi hoàn.
- **Nhược điểm:** Hệ thống chấp nhận trạng thái nhất quán cuối cùng (Eventual Consistency) - có khoảng thời gian tồn kho bị giữ dù đơn chưa thanh toán.
- **Lưu ý thực tế:** Mọi hành động bù trừ (Compensation) phải có tính chất lũy lượng (Idempotent), nghĩa là gọi `release()` 1 lần hay nhiều lần đều phải cho cùng một kết quả an toàn.

---

## 3. Database per Service (Logical Schema Isolation)

### Vị trí triển khai
- [infra/terraform/environments/lab/main.tf](file:///Users/huy/projects-h/commerceflow-pla-review/infra/terraform/environments/lab/main.tf#L139-L155)
- [apps/order-service/src/infrastructure/postgres-order.repository.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/infrastructure/postgres-order.repository.ts)
- [apps/inventory-service/src/infrastructure/postgres-inventory.repository.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/inventory-service/src/infrastructure/postgres-inventory.repository.ts)
- [docs/adr/ADR-002.md](file:///Users/huy/projects-h/commerceflow-pla-review/docs/adr/ADR-002.md), [ADR-009](file:///Users/huy/projects-h/commerceflow-pla-review/docs/adr/ADR-009.md)

### Như thế nào (Cách thức hiện thực)
- Thay vì dùng 1 database chung với các bảng liên kết bằng Foreign Key qua các module, dự án cấp phát 3 database riêng biệt: `order_db`, `catalog_db`, `inventory_db`.
- Để tối ưu chi phí trong môi trường Lab/Dev (< $50/tháng), cả 3 database này nằm trên cùng 1 Cloud SQL PostgreSQL instance nhưng kết nối qua các chuỗi connection string và credentials riêng biệt.
- Tuyệt đối cấm cross-database query (SELECT JOIN qua database khác) hoặc chia sẻ quan hệ vật lý.

### Vấn đề giải quyết
- Tránh tình trạng phụ thuộc dữ liệu chặt chẽ (tight data coupling). Cho phép các team thay đổi schema, migration phiên bản độc lập mà không làm hỏng các dịch vụ khác.

### Ưu nhược điểm & Lưu ý
- **Ưu điểm:** Đảm bảo ranh giới Bounded Context rõ ràng, dễ dàng tách thành các máy chủ database vật lý riêng khi tải tăng.
- **Nhược điểm:** Không thể dùng ACID transaction để cập nhật đồng thời nhiều bảng của nhiều service; không thể dùng JOIN SQL để lấy dữ liệu tổng hợp.
- **Lưu ý thực tế:** Dùng chung một Cloud SQL instance nghĩa là vẫn chung 1 vùng chịu lỗi (Shared Failure Domain) và giới hạn tài nguyên CPU/IOPS.

---

## 4. API Gateway Pattern

### Vị trí triển khai
- [apps/api-gateway/src/main.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/api-gateway/src/main.ts)
- [infra/kubernetes/base/deployment.yaml](file:///Users/huy/projects-h/commerceflow-pla-review/infra/kubernetes/base/deployment.yaml#L1-L100)

### Như thế nào (Cách thức hiện thực)
- Đóng vai trò Reverse Proxy và cổng tiếp nhận duy nhất cho toàn bộ traffic từ client (Web SPA).
- Kiểm tra chữ ký HMAC-SHA256 JWT trên header `Authorization: Bearer <token>`, trích xuất payload và kiểm tra quyền RBAC (`role: viewer | staff | admin`).
- Định tuyến yêu cầu (Routing): `/api/products` $\rightarrow$ Catalog Service, `/api/orders` $\rightarrow$ Order Service, `/api/inventory` $\rightarrow$ Inventory Service.
- Gắn `X-Correlation-ID` vào mỗi request đi qua nếu client chưa gửi.

### Vấn đề giải quyết
- Ngăn ngừa việc client phải gọi trực tiếp từng microservice phân tán với các địa chỉ IP/port khác nhau.
- Tập trung hóa các logic phi chức năng: bảo mật, phân quyền, CORS, rate limiting, ghi log.

### Ưu nhược điểm & Lưu ý
- **Ưu điểm:** Ẩn giấu kiến trúc mạng nội bộ, quản trị bảo mật tập trung tại ranh giới ngoại vi.
- **Nhược điểm:** Thêm một chặng mạng trung gian (network hop) làm tăng độ trễ tính bằng mili-giây.
- **Lưu ý thực tế:** Không đưa business logic phức tạp vào Gateway (tránh biến Gateway thành "Fat Gateway" hoặc monolith mới).

---

## 5. Retry with Exponential Backoff, Jitter & Dead-Letter Queue (DLQ)

### Vị trí triển khai
- [packages/messaging/src/resilience.ts](file:///Users/huy/projects-h/commerceflow-pla-review/packages/messaging/src/resilience.ts)
- [infra/terraform/environments/lab/main.tf](file:///Users/huy/projects-h/commerceflow-pla-review/infra/terraform/environments/lab/main.tf#L96-L99)

### Như thế nào (Cách thức hiện thực)
- **Phân loại lỗi thông minh (`classifyError`):**
  - `PERMANENT`: Lỗi 400, 401, 403, 422, vi phạm Schema validation $\rightarrow$ Không retry, chuyển ngay sang DLQ hoặc báo lỗi.
  - `TRANSIENT`: Lỗi 503, 504, 429, ngắt kết nối mạng tạm thời, DB timeout $\rightarrow$ Thực hiện retry.
- **Exponential Backoff & Jitter:** Thời gian chờ giữa các lần retry tăng theo cấp số nhân: $T = \min(\text{initialDelay} \times \text{backoffFactor}^{\text{attempt}}, \text{maxDelay}) \pm \text{jitter}$. Jitter là giá trị ngẫu nhiên được cộng/trừ để làm lệch pha các request.
- **Dead-Letter Queue (DLQ):** Khi vượt quá số lần thử lại tối đa (`maxAttempts = 3`), message được lưu vào DLQ với trạng thái `PENDING_REVIEW` để không làm nghẽn tiến trình của các message khác. Hỗ trợ hàm `replayDeadLetterMessage()` khi sự cố hạ tầng được khắc phục.

### Vấn đề giải quyết
- Giúp hệ thống tự phục hồi trước các trục trặc mạng tạm thời. Tránh hiện tượng **Thundering Herd Problem** (hàng ngàn client đồng loạt retry tại cùng một thời điểm đánh sập server vừa phục hồi).

### Ưu nhược điểm & Lưu ý
- **Ưu điểm:** Nâng cao tính tự phục hồi (Fault Tolerance) của hệ thống.
- **Lưu ý thực tế:** Luôn cần theo dõi số lượng message trong DLQ; nếu số lượng tăng đột biến, hệ thống cần kích hoạt cảnh báo tới đội ngũ trực vận hành (On-call engineers).

---

## 6. Health Endpoint Monitoring Pattern (Liveness & Readiness Probes)

### Vị trí triển khai
- [packages/health/src/health-checker.ts](file:///Users/huy/projects-h/commerceflow-pla-review/packages/health/src/health-checker.ts)
- [infra/kubernetes/base/deployment.yaml](file:///Users/huy/projects-h/commerceflow-pla-review/infra/kubernetes/base/deployment.yaml#L60-L77)

### Như thế nào (Cách thức hiện thực)
- Cung cấp lớp trừu tượng `HealthProbeService` với 2 loại kiểm tra riêng biệt:
  - `getLivenessReport()`: Kiểm tra tiến trình có phản hồi không, đo lường `uptimeSeconds` và `memoryUsage`. Trả về `ALIVE` hoặc `DEAD`.
  - `getReadinessReport()`: Chạy các checkers kiểm tra tính sẵn sàng của hạ tầng phụ thuộc (PostgreSQL pool query `SELECT 1`, kết nối Pub/Sub). Trả về `HEALTHY` hoặc `UNHEALTHY`.
- Trong manifest Kubernetes / Cloud Run:
  - `livenessProbe` gọi `/live`: nếu fail 3 lần $\rightarrow$ Kubernetes lập tức Restart/Kill container.
  - `readinessProbe` gọi `/ready`: nếu fail $\rightarrow$ Kubernetes ngắt routing traffic tới pod này nhưng **KHÔNG restart**.

### Vấn đề giải quyết
- Tự động hóa giám sát vòng đời ứng dụng trên Cloud/Kubernetes. Tránh tình trạng người dùng nhận lỗi 502/503 khi container mới đang khởi động hoặc khi database bị nghẽn kết nối tạm thời.

### Ưu nhược điểm & Lưu ý
- **Lưu ý sống còn:** Tuyệt đối không kiểm tra database trong Liveness Probe! Nếu database bị chậm, tất cả các pods sẽ đồng loạt tự sát (restart loop), gây ra thảm họa sập toàn bộ hệ thống (Cascading Failure). Database chỉ được kiểm tra trong Readiness Probe.

---

## 7. Distributed Tracing & Correlation Identifier

### Vị trí triển khai
- [packages/messaging/src/event-bus.ts](file:///Users/huy/projects-h/commerceflow-pla-review/packages/messaging/src/event-bus.ts#L16-L26)
- [packages/contracts/src/order.ts](file:///Users/huy/projects-h/commerceflow-pla-review/packages/contracts/src/order.ts)
- [docs/adr/ADR-008.md](file:///Users/huy/projects-h/commerceflow-pla-review/docs/adr/ADR-008.md)

### Như thế nào (Cách thức hiện thực)
- Mọi gói tin sự kiện `EventEnvelope` và mọi HTTP request đều mang hai định danh:
  - `correlationId`: Mã định danh duy nhất xuyên suốt toàn bộ vòng đời của chuỗi giao dịch từ lúc người dùng nhấn "Đặt hàng" trên UI, đi qua Gateway, sang Order Service, sang Pub/Sub, tới Inventory Service.
  - `causationId`: Mã định danh của sự kiện hoặc câu lệnh trực tiếp sinh ra sự kiện hiện tại (quan hệ nhân quả cha - con).

### Vấn đề giải quyết
- Trong hệ thống microservices bất đồng bộ, một hành động của người dùng kích hoạt hàng chục sự kiện ở các tiến trình khác nhau. Correlation ID cho phép lọc và ghép nối toàn bộ log phân tán của một giao dịch đơn lẻ trên Cloud Logging/OpenTelemetry.

---

## 8. Scale-to-Zero & Cloud Cost Optimization Pattern

### Vị trí triển khai
- [infra/terraform/environments/lab/main.tf](file:///Users/huy/projects-h/commerceflow-pla-review/infra/terraform/environments/lab/main.tf#L168-L224)
- [docs/adr/ADR-004.md](file:///Users/huy/projects-h/commerceflow-pla-review/docs/adr/ADR-004.md), [ADR-005](file:///Users/huy/projects-h/commerceflow-pla-review/docs/adr/ADR-005.md)

### Như thế nào (Cách thức hiện thực)
- Triển khai dịch vụ trên Google Cloud Run với cấu hình Serverless: `min_instance_count = 0` và `max_instance_count = 3`.
- Khi không có lưu lượng truy cập (đêm, ngoài giờ học lab), số lượng container tự động co về 0 (Scale-to-Zero), chi phí CPU và RAM bằng \$0.
- Cấu hình Cloud SQL sử dụng cấu hình tối thiểu `db-f1-micro` và tắt chế độ Regional High Availability (ZONAL single-zone) để tiết kiệm ngân sách.

### Vấn đề giải quyết
- Giữ vững cam kết ngân sách đám mây không vượt quá \$50 USD/tháng cho môi trường học tập và thử nghiệm.

### Ưu nhược điểm & Lưu ý
- **Ưu điểm:** Tối ưu hóa chi phí tối đa, chỉ trả tiền cho tài nguyên khi có request thực tế.
- **Nhược điểm:** Gây ra hiện tượng **Cold Start** (request đầu tiên sau thời gian rảnh sẽ mất 1 - 3 giây để khởi động lại container).
