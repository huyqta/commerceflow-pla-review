# Bằng chứng Kiểm chứng Issue CF-032: Terraform, State, IAM và Validate/Plan

## 1. Thông tin Issue & Môi trường thực thi
- **Issue ID:** CF-032
- **Tiêu đề:** Terraform, state, IAM và validate/plan
- **Milestone:** M6 (Containerization, Kubernetes & Production Readiness)
- **Môi trường:**
  - OS: Windows 11
  - Node.js runtime: v24.12.0 LTS
  - Command execution: Standard local testing (Zero Cloud Resource Creation)

> [!IMPORTANT]
> **Cam kết Cloud Policy:** Issue này chỉ thực hiện soạn thảo kiến trúc, đặc tả module, remote state backend GCS, quy tắc least privilege IAM, và phân biệt giữa `plan` và `apply`. **Tuyệt đối KHÔNG chạy `terraform apply` hoặc tạo tài nguyên thật trên Google Cloud Platform (GCP)**.

---

## 2. Kết quả Chạy Micro-lab
- **Command:** `node labs/CF-032/demo.mjs`
- **Exit code:** `0`
- **Output:**
```
MICRO_LAB_OK CF-032
```
- **Phân tích Micro-lab:**
  Mã kiểm tra tính an toàn của danh sách lệnh được phép chạy tự động:
  `const terraformCommands=['fmt','validate','plan']; assert.equal(terraformCommands.includes('apply'),false);`.
  Lệnh `apply` bị loại trừ hoàn toàn khỏi luồng tự động để tránh tác động đột biến không kiểm soát lên hạ tầng cloud.

---

## 3. Kết quả Chạy Automated Test Suite (CF-032)
- **Command:** `node --test tests/deployment/terraform.test.ts`
- **Exit code:** `0`
- **Output:**
```
▶ CF-032: Terraform, State, IAM & Validate/Plan Workflow
  ✔ xác minh tài liệu infra/terraform/README.md tồn tại và chứa đầy đủ các phân mục chuẩn (1.309ms)
  ✔ xác thực danh sách lệnh an toàn trong CI (khớp micro-lab) (0.1602ms)
  ✔ thử thách độc lập: mô phỏng sự khác biệt giữa plan và apply (State Diff vs State Mutation) (0.1674ms)
  ✔ negative case: phát hiện và từ chối các vi phạm bảo mật (Least Privilege & Secret Leaking) (0.3098ms)
✔ CF-032: Terraform, State, IAM & Validate/Plan Workflow (2.8489ms)
ℹ tests 4
ℹ suites 1
ℹ pass 4
ℹ fail 0
```

---

## 4. Negative / Boundary Test Cases
- **Case 1: Vi phạm nguyên tắc phân quyền đặc quyền tối thiểu (Least Privilege IAM):**
  - *Input:* Cấp quyền primitive `roles/owner` hoặc `roles/editor` cho Service Account CI/CD.
  - *Expected Result:* Bị từ chối trong kiểm thử bảo mật.
  - *Observed Result:* Test suite khẳng định Service Account chỉ được cấp các scoped roles tối thiểu (`roles/artifactregistry.writer`, `roles/viewer`).
- **Case 2: Rò rỉ file trạng thái (State File Secret Leaking):**
  - *Input:* File `.gitignore` bỏ quên `*.tfstate`.
  - *Expected Result:* Kiểm tra xác thực `.gitignore` phải chứa `tfstate` và `.env` để bảo vệ secrets plain-text không bị đẩy lên Git công khai.
  - *Observed Result:* Passed.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Lưu State chứa Secrets Công khai
- **Vấn đề cốt lõi:**
  Nhiều tài nguyên hạ tầng (như database passwords, private keys, service account credentials) khi được tạo ra qua Terraform sẽ được lưu trữ dưới dạng **plain text** bên trong tệp `terraform.tfstate`.
- **Rủi ro lớn:**
  Nếu commit `terraform.tfstate` lên Git repository công khai hoặc lưu trên GCS bucket mở quyền đọc (`allUsers` hoặc `allAuthenticatedUsers`), toàn bộ mật khẩu cơ sở dữ liệu sẽ bị lộ hoàn toàn.
- **Giải pháp bắt buộc của CommerceFlow:**
  1. Thêm `*.tfstate`, `*.tfstate.*`, và `.terraform/` vào tệp `.gitignore`.
  2. Bật chính sách GCP Organization Policy: Chặn public access trên GCS bucket (`enforcePublicAccessPrevention`).
  3. Sử dụng Google Secret Manager tích hợp để truyền mật khẩu thay vì hardcode trong Terraform inputs/outputs.

### 5.2. Thử thách độc lập: Giải thích Plan khác Apply?
- **Sự khác biệt bản chất:**
  - `terraform plan` là thao tác **Read-Only / Pure Function**: Đọc trạng thái live từ cloud qua API providers, đọc file state hiện tại, so sánh với mã nguồn HCL, và hiển thị kế hoạch biến đổi (`diff`). Nó **không bao giờ biến đổi (mutate)** trạng thái của tài nguyên đang chạy.
  - `terraform apply` là thao tác **Side-Effect / State Mutation**: Gửi các lệnh API thực sự (POST/PUT/DELETE) lên Google Cloud để tạo mới, sửa đổi hoặc xóa tài nguyên, sau đó ghi đè state mới vào GCS backend.
- **Minh họa rủi ro:**
  Nếu vô tình chạy `apply` khi thay đổi một thuộc tính đòi hỏi tạo lại (forces replacement) như phiên bản PostgreSQL trên Cloud SQL, cụm cơ sở dữ liệu hiện tại sẽ bị xóa sạch, gây gián đoạn dịch vụ và mất dữ liệu. Lệnh `plan` giúp phát hiện rủi ro này trong giai đoạn review trước khi bất kỳ thay đổi nào xảy ra.
