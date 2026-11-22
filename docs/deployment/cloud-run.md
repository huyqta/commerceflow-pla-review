# Kế hoạch Triển khai Cloud Run, Xác thực Sự kiện Pub/Sub Push & Cơ chế Rollback Revision

## 1. Giới thiệu & Mục tiêu
Tài liệu này xác định kiến trúc triển khai serverless trên **Google Cloud Run** cho các dịch vụ thuộc nền tảng **CommerceFlow**, bao gồm:
- Quy trình triển khai an toàn theo cơ chế duyệt riêng (Approval Gates & Cloud Guard).
- Ràng buộc danh tính (Identity Binding) và xác thực Pub/Sub Push Events qua OIDC Token & role `roles/run.invoker`.
- Cấu hình Health Checks (Liveness/Startup Probes).
- Cơ chế quản lý Revision và Rollback tức thì (Instant Traffic Shifting).
- Loại bỏ hoàn toàn nguy cơ để lộ endpoint consumer công khai không xác thực (Unauthenticated Webhook Vulnerability).

> [!IMPORTANT]
> **CẢNH BÁO NGUYÊN TẮC BẢO MẬT & CHI PHÍ CLOUD (GCP POLICY):**
> Tài liệu và mã nguồn kiểm thử này vận hành trên cơ chế **Default-Deny (Mặc định Từ chối)** thông qua `labs/CF-035/cloud-guard.mjs`. **Tuyệt đối KHÔNG thực hiện lệnh `gcloud run deploy` hoặc `terraform apply` lên Google Cloud Platform trong Issue này**. Việc triển khai thực tế chỉ được kích hoạt sau khi có sự phê duyệt trực tiếp bằng văn bản từ Quản trị viên kèm dự toán chi phí đã được ký duyệt.

---

## 2. Quy trình Triển khai Cloud Run & Cơ chế Phê duyệt (Deployment Workflow)

```
[Developer / CI Runner]
         │
         ▼
[1. Static Inspection & Cost Guard]
   - Kiểm tra dự toán: estimatedUsd <= $50/tháng
   - Kiểm tra Approval: CLOUD_APPLY_APPROVED == 'true'
   - Nếu FALSE -> Default Deny (Ngắt ngay lập tức)
         │ (Nếu TRUE)
         ▼
[2. Build Container & Tag Digest]
   - Image trỏ đích danh immutable SHA-256 digest:
     asia-southeast1-docker.pkg.dev/commerceflow-sandbox-dev/commerceflow-apps/api-gateway@sha256:...
         │
         ▼
[3. Cloud Run Service Configuration]
   - min_instances = 0 (Scale-to-Zero để tiết kiệm chi phí)
   - max_instances = 3 (Giới hạn trần để chống bão chi phí)
   - Ingress: `internal-and-cloud-load-balancing` hoặc `all` (đối với public gateway)
   - Authentication: Bắt buộc yêu cầu xác thực OIDC đối với các event push callbacks
         │
         ▼
[4. Health Check Verification]
   - Startup Probe: Kiểm tra khởi động trong vòng 10s
   - Liveness Probe: Endpoint `/health/liveness`
```

---

## 3. Xác thực Sự kiện Đẩy (Authenticated Pub/Sub Push Events)

### 3.1. Rủi ro của Webhook Công khai Không Xác thực (Trade-off Analysis)
- **Vấn đề nguy hiểm:** Nếu triển khai Cloud Run nhận sự kiện từ Pub/Sub qua cơ chế Push Subscription mà cho phép truy cập không xác thực (`--allow-unauthenticated` hoặc cấp `roles/run.invoker` cho `allUsers`), bất kỳ kẻ tấn công nào trên Internet cũng có thể giả mạo gói tin HTTP POST gửi vào endpoint `/events/order-created` hoặc `/events/payment-succeeded`.
- **Hậu quả:** Gây ra các cuộc tấn công phát sinh đơn hàng ảo, giả mạo thanh toán thành công, hoặc gây tràn ngập tài nguyên (DoS) làm tài khoản cạn kiệt ngân sách.

### 3.2. Giải pháp Ràng buộc Danh tính (Identity Binding & OIDC Verification)
Mọi Pub/Sub Push Subscription bắt buộc phải được liên kết với một Service Account chuyên dụng mang quyền tối thiểu:
1. **Tạo Service Account Invoker:** `sa-pubsub-invoker@commerceflow-sandbox-dev.iam.gserviceaccount.com`.
2. **Cấp quyền hạn chế:** Cấp duy nhất role `roles/run.invoker` trên dịch vụ Cloud Run đích cho Service Account trên.
3. **Cấu hình OIDC Token trong Subscription:**
   ```hcl
   resource "google_pubsub_subscription" "order_events_push" {
     name  = "order-events-cloudrun-push"
     topic = google_pubsub_topic.order_events.id

     push_config {
       push_endpoint = "https://commerceflow-api-gateway-xxx.a.run.app/events/push"

       oidc_token {
         service_account_email = "sa-pubsub-invoker@commerceflow-sandbox-dev.iam.gserviceaccount.com"
         audience              = "https://commerceflow-api-gateway-xxx.a.run.app"
       }
     }
   }
   ```
4. **Xác thực tại ứng dụng (Backend Consumer Validation):**
   Mã nguồn nhận request phải kiểm tra:
   - Header `Authorization: Bearer <ID_TOKEN>`.
   - Token được ký bởi Google (`accounts.google.com`).
   - Claim `email` khớp với Service Account được ủy quyền.
   - Claim `aud` (audience) khớp chính xác với URL dịch vụ Cloud Run.

---

## 4. Quản lý Revision & Cơ chế Rollback Tức thì (Traffic Shifting)

Cloud Run quản lý mỗi lần deploy dưới dạng một **Revision bất biến**. Điều này cho phép thực hiện rollback phiên bản mà không cần build lại code hay deploy lại container.

### 4.1. Kịch bản Rollback khi Revision mới gặp sự cố (Scenario)
- **Revision `api-gateway-00002-xyz` (Bản mới):** Bị lỗi rò rỉ bộ nhớ hoặc tỷ lệ lỗi 5xx tăng vọt lên 10%.
- **Revision `api-gateway-00001-abc` (Bản cũ ổn định):** Đã được kiểm chứng chạy hoàn hảo trước đó.

### 4.2. Lệnh Rollback Tức thì (Instant Traffic Shifting)
Thay vì chờ CI/CD build lại, SRE điều hướng 100% lưu lượng về revision cũ chỉ bằng một lệnh điều phối traffic:
```bash
gcloud run services update-traffic commerceflow-api-gateway \
  --to-revisions=api-gateway-00001-abc=100 \
  --region=asia-southeast1
```
- **Thời gian hoàn nguyên:** < 2 giây.
- **Tính sẵn sàng:** 100% traffic chuyển sang revision cũ ngay lập tức mà không rớt request (Zero Downtime).

---

## 5. Thử thách Độc lập: Chứng minh Quyền `roles/run.invoker`

### 5.1. Mô hình Phân quyền IAM
- Quyền `roles/run.invoker` cho phép một principal gửi HTTP request đến Cloud Run service đang ở chế độ riêng tư (Ingress Private / Require Authentication).
- **Phép thử chứng minh (Verification Test):**
  1. Gửi request không có Header `Authorization` $\to$ Cloud Run frontend proxy trả về ngay mã lỗi **HTTP 401 Unauthorized** hoặc **403 Forbidden** trước khi request chạm vào container.
  2. Gửi request có OIDC Token từ Service Account không có role `roles/run.invoker` $\to$ Trả về **HTTP 403 Forbidden**.
  3. Gửi request có OIDC Token hợp lệ cấp cho `sa-pubsub-invoker` với đúng Audience $\to$ Trả về **HTTP 200 OK** và xử lý sự kiện an toàn.
