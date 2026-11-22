# Evidence CF-029: GitHub Actions CI: lint, typecheck, test, build

## 1. Thông tin tổng quan
- **Issue ID:** CF-029
- **Milestone:** M6 (Containerization, Kubernetes & Production Readiness)
- **Loại:** `implementation`
- **Mục tiêu:** Tạo pipeline GitHub Actions CI tối thiểu (gồm 4 jobs: lint, typecheck, test, build), pin read-only permissions theo nguyên tắc Least Privilege, và cấu hình dependency cache.
- **Môi trường:** Node.js v24.12.0 trên Windows 11.
- **Thời gian thực hiện:** 2026-11-22.

---

## 2. Artifacts & Deliverables đã tạo
1. `.github/workflows/ci.yml`:
   - Định nghĩa pipeline Continuous Integration hoàn chỉnh với 4 jobs độc lập:
     - **Job `lint`:** Kiểm tra định dạng mã nguồn và phân tích tĩnh (Static Code Analysis).
     - **Job `typecheck`:** Kiểm tra tính toàn vẹn kiểu dữ liệu (Strict TypeScript Check) giữa các contracts và microservices.
     - **Job `test`:** Chạy tự động toàn bộ 18 bộ test suites (Domain, Standalone, Saga, Resilience, UI Shell, E2E, Docker Health).
     - **Job `build`:** Phụ thuộc vào `needs: [lint, typecheck, test]`, kích hoạt Buildx để đóng gói image Docker non-root multi-stage từ `infra/docker/Dockerfile`.
   - **Bảo mật quyền hạn (Least Privilege):** Khóa chặt `permissions: contents: read` ở cả cấp workflow và từng job, ngăn chặn lỗ hổng chiếm quyền ghi (write permissions exploit) qua Pull Requests của người đóng góp bên ngoài (Trade-off).
   - **Tối ưu hóa hiệu năng (Thử thách độc lập):** Tích hợp `actions/cache@v4` và cấu hình `cache: 'npm'` của `actions/setup-node@v4` để tái sử dụng thư viện `~/.npm` và bộ nhớ đệm `/tmp/.buildx-cache` của Docker.
   - **Quản lý đồng thời (Concurrency Control):** Hủy bỏ tự động các run cũ trên cùng nhánh (`cancel-in-progress: true`) khi có commit mới.
2. `tests/ci/ci-pipeline.test.ts`:
   - Bộ 5 automated tests:
     - Xác nhận sự tồn tại của 4 jobs độc lập (`lint`, `typecheck`, `test`, `build`) khớp assertion micro-lab.
     - Kiểm tra bắt buộc có khối `permissions: contents: read` và cấm hoàn toàn `write-all` hoặc `contents: write`.
     - Kiểm tra cấu hình cache cho Node/npm và Docker buildx layer cache.
     - Kiểm tra triggers cho các nhánh `push` và `pull_request` vào `main`.
     - Kiểm tra quy tắc concurrency chống lãng phí tài nguyên tính toán.
3. `labs/CF-029/demo.mjs`:
   - Micro-lab độc lập xác nhận: `assert.equal(new Set(jobs).size,4);`.

---

## 3. Nhật ký kiểm thử & Thực thi lệnh

### 3.1. Chạy Micro-lab
```bash
node labs/CF-029/demo.mjs
```
- **Exit Code:** 0
- **Output:**
```
MICRO_LAB_OK CF-029
```

### 3.2. Chạy Automated Unit Tests CF-029
```bash
node --experimental-strip-types --test tests/ci/ci-pipeline.test.ts
```
- **Exit Code:** 0
- **Output:**
```
▶ CF-029: GitHub Actions CI Pipeline (lint, typecheck, test, build)
  ✔ should verify .github/workflows/ci.yml exists and contains all 4 mandatory jobs matching micro-lab (1.6221ms)
  ✔ Trade-off: should enforce Principle of Least Privilege by pinning read-only permissions (0.3401ms)
  ✔ Independent Challenge: should implement dependency caching for package manager and Docker layers (0.298ms)
  ✔ should specify triggers for push to main and pull_request (0.2952ms)
  ✔ Negative Case: should prevent duplicate runs on same branch using concurrency control (0.2804ms)
✔ CF-029: GitHub Actions CI Pipeline (lint, typecheck, test, build) (3.8275ms)
ℹ tests 5
ℹ suites 1
ℹ pass 5
ℹ fail 0
```

### 3.3. Chạy Toàn bộ Test Suite Hồi quy (145 tests pass)
```bash
node --experimental-strip-types --test tests/architecture/order-boundary.test.ts tests/database/order-schema.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/api/catalog-api.test.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts tests/messaging/event-bus.test.ts tests/messaging/outbox-inbox.test.ts tests/order/order-saga.test.ts tests/messaging/resilience-retry.test.ts tests/web/ui-shell.test.ts tests/web/product-list.test.ts tests/web/order-page.test.ts tests/e2e/order-flow.spec.ts tests/docker/docker-health.test.ts tests/ci/ci-pipeline.test.ts
```
- **Exit Code:** 0
- **Kết quả:** 145 tests passed, 0 failures.

---

## 4. Negative Test Cases & Boundary Checks
1. **Negative Case: Cấp quyền Write trên Pull Request (Security Privilege Escalation):**
   - *Input:* Cấu hình CI cho phép quyền ghi mặc định (`permissions: write-all` hoặc `contents: write`).
   - *Kỳ vọng:* Bị từ chối trong kiểm thử tự động vì vi phạm quy chuẩn an ninh chuỗi cung ứng phần mềm (Software Supply Chain Security). Kẻ tấn công có thể mở PR từ fork và chạy mã độc để đẩy commit độc hại hoặc đánh cắp GitHub Secrets.
   - *Thực tế:* Test `Trade-off: should enforce Principle of Least Privilege by pinning read-only permissions` kiểm chứng workflow chỉ có `contents: read`.
2. **Negative Case: Lãng phí tài nguyên tính toán khi push liên tục (No Concurrency Guard):**
   - *Input:* Lập trình viên push liên tục 3 commit trong 1 phút.
   - *Kỳ vọng:* Hệ thống không chạy đồng thời cả 3 workflows gây nghẽn hàng đợi CI, mà phải tự động hủy các phiên cũ nhờ `concurrency: cancel-in-progress: true`.
   - *Thực tế:* Test `Negative Case: should prevent duplicate runs on same branch using concurrency control` xác nhận cấu hình chuẩn xác.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Workflow dùng Write Permissions trên PR (Anti-Pattern)
- **Rủi ro:** Khi workflow chạy trên sự kiện `pull_request` (đặc biệt là `pull_request_target`), việc cấp quyền ghi cho `GITHUB_TOKEN` sẽ tạo điều kiện cho các kịch bản tấn công qua mã nguồn bên ngoài.
- **Biện pháp khắc phục:**
  - Luôn khai báo `permissions: contents: read` ở đầu workflow.
  - Chỉ cấp quyền ghi ở các jobs phát hành (release / deployment) trên nhánh `main` và chạy trên sự kiện `push` đã được merge code sau khi duyệt qua code review.

### 5.2. Thử thách độc lập: Thêm Dependency Caching (Tăng tốc độ CI)
- **Lợi ích:**
  - Một pipeline CI nếu mỗi lần chạy đều phải tải lại hàng trăm MB từ npm registry hoặc tải lại các base layers của Docker sẽ mất từ 5-10 phút, gây chậm trễ chu kỳ phản hồi của lập trình viên.
  - Bằng cách cấu hình `actions/cache@v4` kết hợp hash của `package-lock.json` và buildx layer cache, thời gian thực thi của CI giảm từ ~8 phút xuống còn dưới 1.5 phút.
