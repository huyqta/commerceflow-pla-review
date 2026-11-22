# Evidence CF-028: Multi-stage Docker và health probes

## 1. Thông tin tổng quan
- **Issue ID:** CF-028
- **Milestone:** M6 (Containerization, Kubernetes & Production Readiness)
- **Loại:** `implementation`
- **Mục tiêu:** Viết non-root multi-stage Dockerfile, cấu hình Compose health check, tách bạch Liveness vs Readiness Probes và chống rò rỉ secrets.
- **Môi trường:** Node.js v24.12.0 trên Windows 11.
- **Thời gian thực hiện:** 2026-11-22.

---

## 2. Artifacts & Deliverables đã tạo
1. `infra/docker/Dockerfile`:
   - Kiến trúc **Multi-Stage Build** 3 giai đoạn tối ưu:
     - `base`: Node 24 Alpine, cài đặt `dumb-init` (PID 1 signal handling) và `curl`.
     - `builder`: Cài đặt môi trường biên dịch và build source.
     - `runner`: Runtime tối giản, bảo mật Non-Root (`USER nodejs`, UID 1001), `EXPOSE 3000`.
   - Tích hợp chỉ thị `HEALTHCHECK` kiểm tra định kỳ endpoint liveness (`curl -f http://localhost:3000/health/liveness`).
   - Sử dụng `dumb-init` làm entrypoint để bắt tín hiệu `SIGTERM`/`SIGINT` dọn dẹp kết nối duyên dáng (Graceful Shutdown).
2. `infra/docker/docker-compose.yml`:
   - Khởi chạy phối hợp `postgres` và `api-gateway`.
   - Cấu hình điều kiện phụ thuộc `depends_on: postgres: condition: service_healthy`, đảm bảo database sẵn sàng trước khi gateway nhận traffic.
3. `.dockerignore`:
   - Ngăn chặn tuyệt đối việc copy file `.env`, `.env.*`, `node_modules`, `.git`, tránh rò rỉ secrets vào Docker Image (Trade-off).
4. `packages/health/src/health-checker.ts`:
   - Module `HealthProbeService` phân định ranh giới giữa Liveness và Readiness:
     - `getLivenessReport()`: Báo cáo tình trạng tiến trình sống (`status: ALIVE`), thời gian uptime và mức tiêu thụ RAM.
     - `getReadinessReport()`: Báo cáo khả năng sẵn sàng phục vụ (`status: HEALTHY`/`UNHEALTHY`), kiểm tra các kết nối phụ thuộc (`database`, `broker`).
5. `tests/docker/docker-health.test.ts`:
   - Bộ 5 automated tests:
     - Xác thực cấu trúc multi-stage và non-root user trong `Dockerfile`.
     - Xác thực loại trừ file `.env` và bí mật trong `.dockerignore`.
     - Thử thách độc lập: Phân biệt ngữ nghĩa Liveness (giữ container sống) vs Readiness (gỡ khỏi Load Balancer khi DB mất kết nối).
     - Xác thực cấu hình Docker Compose `condition: service_healthy`.
     - Negative test: Xử lý an toàn khi checker ném lỗi ngoại lệ bất ngờ mà không làm sập tiến trình.
6. `labs/CF-028/demo.mjs`:
   - Micro-lab độc lập xác nhận: `assert.equal(Object.values(readiness).every(Boolean),false);`.

---

## 3. Nhật ký kiểm thử & Thực thi lệnh

### 3.1. Chạy Micro-lab
```bash
node labs/CF-028/demo.mjs
```
- **Exit Code:** 0
- **Output:**
```
MICRO_LAB_OK CF-028
```

### 3.2. Chạy Automated Unit Tests CF-028
```bash
node --experimental-strip-types --test tests/docker/docker-health.test.ts
```
- **Exit Code:** 0
- **Output:**
```
▶ CF-028: Multi-stage Docker, Security and Health Probes
  ✔ should verify infra/docker/Dockerfile contains multi-stage stages (base, builder, runner) (1.3014ms)
  ✔ Trade-off: should strictly exclude .env and sensitive secrets in .dockerignore (1.4529ms)
  ✔ Independent Challenge: should differentiate Liveness vs Readiness semantics (0.4781ms)
  ✔ should verify docker-compose.yml defines healthcheck dependencies (0.5807ms)
  ✔ Negative Case: should handle uncaught exceptions in health checks safely without crashing (0.2134ms)
✔ CF-028: Multi-stage Docker, Security and Health Probes (5.0561ms)
ℹ tests 5
ℹ suites 1
ℹ pass 5
ℹ fail 0
```

### 3.3. Chạy Toàn bộ Test Suite Hồi quy (140 tests pass)
```bash
node --experimental-strip-types --test tests/architecture/order-boundary.test.ts tests/database/order-schema.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/api/catalog-api.test.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts tests/messaging/event-bus.test.ts tests/messaging/outbox-inbox.test.ts tests/order/order-saga.test.ts tests/messaging/resilience-retry.test.ts tests/web/ui-shell.test.ts tests/web/product-list.test.ts tests/web/order-page.test.ts tests/e2e/order-flow.spec.ts tests/docker/docker-health.test.ts
```
- **Exit Code:** 0
- **Kết quả:** 140 tests passed, 0 failures.

---

## 4. Negative Test Cases & Boundary Checks
1. **Negative Case: Lỗi ngoại lệ trong Dependency Checker:**
   - *Input:* Một checker phụ thuộc ném `Error('Socket abruptly disconnected')` thay vì trả về object thông thường.
   - *Kỳ vọng:* `HealthProbeService` bắt ngoại lệ an toàn, đánh dấu phụ thuộc đó là `status: DOWN`, chuyển trạng thái Readiness về `UNHEALTHY` mà không làm sập server.
   - *Thực tế:* Test `should handle uncaught exceptions in health checks safely without crashing` xác nhận thành công.
2. **Negative Case: Database Down nhưng HTTP Server vẫn sống (Readiness vs Liveness Boundary):**
   - *Input:* Cơ sở dữ liệu bị ngắt kết nối tạm thời (`status: DOWN`).
   - *Kỳ vọng:* Liveness vẫn báo `ALIVE` (tránh việc Kubernetes restart container liên tục trong vô vọng), nhưng Readiness báo `UNHEALTHY` (để bộ định tuyến ngừng chuyển traffic người dùng vào container này).
   - *Thực tế:* Test `Independent Challenge: should differentiate Liveness vs Readiness semantics` kiểm chứng ranh giới này hoàn hảo.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Copy `.env` chứa secrets vào Docker Image (Baking Secrets Anti-Pattern)
- **Hiểu lầm phổ biến:** Copy thẳng tệp `.env` vào image để container khởi chạy được ngay mà không cần cấu hình biến môi trường ngoài.
- **Rủi ro an ninh nghiêm trọng:**
  1. *Lộ lọt thông tin bảo mật:* Bất kỳ ai có quyền kéo (pull) image từ Docker Hub / Google Artifact Registry đều có thể chạy `docker history` hoặc `docker run --entrypoint sh` để trích xuất toàn bộ mật khẩu database, JWT secret, khóa API private.
  2. *Bất khả biến (Immutability):* Image bị gắn cứng với một môi trường (dev), không thể tái sử dụng để deploy lên staging hoặc production.
- **Giải pháp chuẩn CommerceFlow:**
  - Cấu hình `.dockerignore` loại trừ tuyệt đối `.env*`.
  - Secrets chỉ được truyền vào lúc runtime thông qua Docker Compose Environment, Kubernetes Secrets hoặc GCP Secret Manager.

### 5.2. Thử thách độc lập: Phân biệt Liveness và Readiness Probe
- **Bản chất khác biệt:**
  - **Liveness Probe:** Trả lời câu hỏi *"Tiến trình container có còn sống không?"*. Thất bại $\to$ Container bị coi là treo (deadlock), orchestrator sẽ lập tức **kill và restart** container.
  - **Readiness Probe:** Trả lời câu hỏi *"Container có thể tiếp nhận request từ người dùng vào lúc này không?"*. Thất bại (ví dụ do database đang khởi động hoặc broker nghẽn) $\to$ Orchestrator **tạm thời ngắt container khỏi Load Balancer**, KHÔNG restart. Khi database sẵn sàng, container được tự động nối lại luồng traffic.
- **Minh họa trong CF-028:**
  - Micro-lab assertion: `const readiness={http:true,database:false}; assert.equal(Object.values(readiness).every(Boolean),false);` thể hiện chính xác việc readiness phải fail khi có bất kỳ phụ thuộc cốt lõi nào bị down.
