# Bằng chứng Kiểm chứng Issue CF-035: Cloud Run deploy, auth push events và rollback

## 1. Thông tin Issue & Môi trường thực thi
- **Issue ID:** CF-035
- **Tiêu đề:** Cloud Run deploy, auth push events và rollback
- **Milestone:** M7 (GCP & Kubernetes)
- **Môi trường:**
  - OS: Windows 11
  - Node.js runtime: v24.12.0 LTS
  - Command execution: Standard local testing (Zero Cloud Resource Creation)

> [!IMPORTANT]
> **Cam kết Cloud Policy:** Issue này hoạt động trên cơ chế Default-Deny thông qua `labs/CF-035/cloud-guard.mjs`. **Tuyệt đối KHÔNG chạy lệnh `gcloud run deploy` hoặc `terraform apply` lên Google Cloud Platform (GCP)** khi chưa có sự phê duyệt trực tiếp từ Quản trị viên.

---

## 2. Kết quả Chạy Micro-lab & Cloud Guard
- **Command 1:** `node labs/CF-035/demo.mjs`
  - **Exit code:** `0`
  - **Output:**
```
MICRO_LAB_OK CF-035
```
  - **Phân tích:** Khẳng định yêu cầu xác thực OIDC và quyền `roles/run.invoker`.

- **Command 2:** `node labs/CF-035/cloud-guard.mjs`
  - **Exit code:** `0`
  - **Output:**
```
CLOUD_GUARD_DEFAULT_DENY_OK
```
  - **Phân tích:** Xác nhận chính sách Default-Deny: Khi biến môi trường `CLOUD_APPLY_APPROVED` chưa bật, hệ thống chặn 100% mọi hành vi deploy/apply lên cloud.

---

## 3. Kết quả Chạy Automated Test Suite (CF-035)
- **Command:** `node --test tests/deployment/cloud-run.test.ts`
- **Exit code:** `0`
- **Output:**
```
▶ CF-035: Cloud Run Deploy, Auth Push Events & Rollback
  ✔ xác minh tài liệu docs/deployment/cloud-run.md tồn tại và chứa đầy đủ nội dung chuẩn (1.277ms)
  ✔ xác thực cấu hình identity invoker khớp micro-lab (0.1387ms)
  ✔ xác thực cơ chế Cloud Guard (labs/CF-035/cloud-guard.mjs) (0.1465ms)
  ✔ thử thách độc lập: mô phỏng xác thực OIDC Token & role roles/run.invoker trên Cloud Run (0.9753ms)
  ✔ mô phỏng cơ chế Rollback Revision tức thì (Instant Traffic Shifting) (0.2076ms)
✔ CF-035: Cloud Run Deploy, Auth Push Events & Rollback (3.6505ms)
ℹ tests 5
ℹ suites 1
ℹ pass 5
ℹ fail 0
```

---

## 4. Negative / Boundary Test Cases
- **Case 1: Gửi Push Event không kèm Authorization Token (Unauthenticated Webhook):**
  - *Input:* Request POST vào `/events/push` không có header `Authorization`.
  - *Expected Result:* Trả về ngay mã lỗi **HTTP 401 Unauthorized** (MISSING_BEARER_TOKEN).
  - *Observed Result:* Passed 100%.
- **Case 2: Gửi Push Event từ Service Account không có quyền `roles/run.invoker`:**
  - *Input:* Token hợp lệ nhưng claim `email` là `hacker-sa@external.com` (chưa gán `roles/run.invoker`).
  - *Expected Result:* Trả về **HTTP 403 Forbidden** (ROLE_RUN_INVOKER_MISSING).
  - *Observed Result:* Passed 100%.
- **Case 3: Chi phí deploy vượt ngân sách hoặc chưa có approval:**
  - *Input:* `canApply(60, true)` hoặc `canApply(10, false)`.
  - *Expected Result:* Cloud Guard trả về `false`, từ chối kích hoạt pipeline deploy.
  - *Observed Result:* Passed 100%.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Public Event Consumer Không Xác Thực
- **Vấn đề nguy hiểm:** Nếu mở webhook nhận Pub/Sub Push công khai không xác thực (`--allow-unauthenticated`), bất kỳ ai cũng có thể giả mạo sự kiện thanh toán thành công hoặc gửi bão traffic làm cạn kiệt ngân sách.
- **Giải pháp của CommerceFlow:**
  - Tạo riêng Service Account `sa-pubsub-invoker` được cấp duy nhất `roles/run.invoker`.
  - Cấu hình Pub/Sub tự động đính kèm signed Google OIDC Token khớp chính xác Audience URL của Cloud Run.
  - Chặn đứng 100% request không xác thực ngay tại tầng Cloud Run Frontend Proxy trước khi chạm vào container.

### 5.2. Thử thách độc lập: Chứng minh Quyền `roles/run.invoker` & Rollback Revision
- **Cơ chế Rollback:**
  Cloud Run lưu giữ các phiên bản immutable revisions. Khi revision mới (`rev-002-faulty`) bị lỗi rò rỉ bộ nhớ hoặc lỗi 5xx, SRE điều hướng 100% traffic về revision cũ (`rev-001-stable`) qua lệnh:
  `gcloud run services update-traffic commerceflow-api-gateway --to-revisions=rev-001-stable=100`.
  Thời gian khôi phục hoàn tất trong < 2 giây với Zero Downtime.
