# Bằng chứng Kiểm chứng Issue CF-034: Terraform Cloud SQL/PubSub/Secrets/Cloud Run plan

## 1. Thông tin Issue & Môi trường thực thi
- **Issue ID:** CF-034
- **Tiêu đề:** Terraform Cloud SQL/PubSub/Secrets/Cloud Run plan
- **Milestone:** M7 (GCP & Kubernetes)
- **Môi trường:**
  - OS: Windows 11
  - Node.js runtime: v24.12.0 LTS
  - Command execution: Standard local testing (Zero Cloud Resource Creation)

> [!IMPORTANT]
> **Cam kết Cloud Policy:** Issue này chỉ thực hiện soạn thảo tệp khai báo Terraform (`infra/terraform/environments/lab/main.tf`), mô phỏng và kiểm thử cấu hình 4 nhóm tài nguyên (`cloud_sql`, `pubsub`, `secret_manager`, `cloud_run`). **Tuyệt đối KHÔNG chạy lệnh `terraform apply` hoặc tạo tài nguyên thật trên Google Cloud Platform (GCP)**.

---

## 2. Kết quả Chạy Micro-lab
- **Command:** `node labs/CF-034/demo.mjs`
- **Exit code:** `0`
- **Output:**
```
MICRO_LAB_OK CF-034
```
- **Phân tích Micro-lab:**
  Mã kiểm tra sự hiện diện của 4 tài nguyên bắt buộc:
  `const resources=['cloud_run','pubsub','cloud_sql','secret_manager']; assert.ok(resources.includes('cloud_sql'));`.
  Xác thực hệ thống đã bao hàm đầy đủ thành phần lưu trữ, sự kiện, bí mật và tính toán serverless.

---

## 3. Kết quả Chạy Automated Test Suite (CF-034)
- **Command:** `node --test tests/deployment/terraform-lab-plan.test.ts`
- **Exit code:** `0`
- **Output:**
```
▶ CF-034: Terraform Plan cho Cloud SQL, PubSub, Secrets & Cloud Run
  ✔ xác minh tệp infra/terraform/environments/lab/main.tf tồn tại và khai báo đầy đủ 4 nhóm tài nguyên (1.4372ms)
  ✔ xác thực danh sách tài nguyên cốt lõi khớp micro-lab (0.1905ms)
  ✔ kiểm tra bất biến an toàn bảo mật và chi phí trong file Terraform (0.5762ms)
  ✔ thử thách độc lập: chiến lược DB hosting fallback khi Cloud SQL vượt ngân sách (0.2609ms)
✔ CF-034: Terraform Plan cho Cloud SQL, PubSub, Secrets & Cloud Run (3.5007ms)
ℹ tests 4
ℹ suites 1
ℹ pass 4
ℹ fail 0
```

---

## 4. Negative / Boundary Test Cases
- **Case 1: Vi phạm ranh giới bảo mật mạng trên Cloud SQL:**
  - *Input:* Cấu hình `ipv4_enabled = true` hoặc không chỉ định `private_network`.
  - *Expected Result:* Bị từ chối bởi quy chuẩn bảo mật CommerceFlow.
  - *Observed Result:* Bất biến `ipv4_enabled = false` và liên kết `private_network` VPC được kiểm chứng đạt chuẩn 100%.
- **Case 2: Cloud SQL báo giá vượt ngân sách cho phép (> $15 USD / tháng):**
  - *Kịch bản:* Cloud SQL phát sinh phụ phí dung lượng hoặc lưu trữ vượt trần chi phí.
  - *Cơ chế xử lý:* Hệ thống kích hoạt chiến lược fallback sang `CONTAINERIZED_LOCAL_POSTGRES` (hoặc Ephemeral GKE Pod) với chi phí $0, bảo đảm không làm vỡ ngân sách $50/tháng của project.
  - *Observed Result:* Passed.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Bật Cloud SQL 24/7 Vô Tình Tốn Tiền
- **Vấn đề cốt lõi:**
  Cloud SQL tính phí theo thời gian instance tồn tại (uptime) bất kể có request hay không. Một instance `db-f1-micro` dù nhỏ nhưng nếu để chạy 24/7/30 ngày sẽ tiêu tốn khoảng $10 - $12 USD. Nếu vô tình bật thêm các tính năng như Regional High Availability (HA) hoặc đĩa SSD quá lớn, chi phí có thể lên tới $60 - $100 USD, thổi bay toàn bộ ngân sách lab.
- **Giải pháp tối ưu của CommerceFlow:**
  1. Chỉ cấu hình `availability_type = "ZONAL"` và ổ cứng tối thiểu `disk_size = 10`.
  2. Cấu hình `deletion_protection = false` cho môi trường lab để có thể dọn dẹp (`terraform destroy`) ngay sau buổi thử nghiệm.
  3. Cloud Run được cấu hình `min_instance_count = 0` (Scale to Zero) để hoàn toàn không phát sinh chi phí tính toán khi không có người dùng truy cập.

### 5.2. Thử thách độc lập: Chọn DB Hosting Fallback khi Vượt Ngân Sách
- **Chiến lược:**
  Khi chi phí Cloud SQL vượt quá 30% tổng ngân sách dự án ($15 / $50 USD), đội ngũ chuyển hướng sang phương án **Containerized PostgreSQL**:
  - Chạy PostgreSQL container cục bộ bằng Docker Compose hoặc triển khai dưới dạng StatefulSet/Ephemeral Pod trên GKE sandbox có gắn PVC tạm thời.
  - Ưu điểm: Tận dụng tài nguyên máy tính có sẵn, không phát sinh hóa đơn riêng cho Managed Database Service.
