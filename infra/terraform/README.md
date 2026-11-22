# Kiến trúc Hạ tầng Mã nguồn (Infrastructure as Code - Terraform) cho CommerceFlow

## 1. Giới thiệu & Mục tiêu
Tài liệu này xác định kiến trúc Terraform cho nền tảng **CommerceFlow**, bao gồm cấu trúc thư mục module hóa, cơ chế quản lý trạng thái từ xa (Remote State Backend với Google Cloud Storage - GCS), chính sách kiểm soát truy cập đặc quyền tối thiểu (Least Privilege IAM), và quy trình kiểm thử tĩnh an toàn (`fmt`, `validate`, `plan`) mà không thực hiện thay đổi môi trường (`apply`).

> [!IMPORTANT]
> **CẢNH BÁO QUY TẮC TRIỂN KHAI CLOUD (GCP POLICY):**
> Tuyệt đối **KHÔNG** chạy lệnh `terraform apply` hoặc `gcloud deploy` tạo tài nguyên thật trên Google Cloud Platform trong Issue này. Mọi cấu hình chỉ dừng lại ở bước soạn thảo, linting (`fmt`), kiểm tra cú pháp (`validate`), và lập kế hoạch thực thi (`plan`). Khi hệ thống chuyển sang giai đoạn cần áp dụng thực tế lên GCP, người phụ trách **bắt buộc phải thông báo và xin phê duyệt trước từ Quản trị viên**.

---

## 2. Cấu trúc Mô-đun Terraform (Module Structure)

```
infra/terraform/
├── README.md                  # Tài liệu kiến trúc & hướng dẫn vận hành IaC
├── environments/              # Cấu hình cụ thể cho từng môi trường
│   ├── dev/
│   │   ├── main.tf            # Root module cho môi trường DEV
│   │   ├── variables.tf       # Biến đầu vào dev
│   │   ├── terraform.tfvars   # Giá trị biến dev (non-sensitive)
│   │   └── backend.tf         # Cấu hình GCS backend state cho DEV
│   └── prod/
│       ├── main.tf            # Root module cho môi trường PROD
│       ├── variables.tf       # Biến đầu vào prod
│       ├── terraform.tfvars   # Giá trị biến prod
│       └── backend.tf         # Cấu hình GCS backend state cho PROD (Object versioning enabled)
└── modules/                   # Các module tái sử dụng
    ├── artifact_registry/     # Quản lý GCP Artifact Registry repositories
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── gke/                   # Quản lý GKE Cluster (VPC-native, Workload Identity)
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── cloud_sql/             # Quản lý Cloud SQL PostgreSQL (Private IP only)
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── iam/                   # Quản lý Service Accounts & IAM Roles (Least Privilege)
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

---

## 3. Quản lý Trạng thái Từ xa (Remote State Backend & State Locking)

### 3.1. Cấu hình Backend GCS (`backend.tf`)
State của Terraform lưu trữ toàn bộ ánh xạ giữa code HCL và tài nguyên thực tế trên GCP. Cấu hình backend chuẩn sử dụng Google Cloud Storage (GCS):
```hcl
terraform {
  required_version = ">= 1.8.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.25.0"
    }
  }

  backend "gcs" {
    bucket                      = "commerceflow-terraform-state-prod"
    prefix                      = "terraform/state/commerceflow"
    impersonate_service_account = "sa-terraform-runner@commerceflow-prod.iam.gserviceaccount.com"
  }
}
```

### 3.2. Bảo vệ State & Khóa đồng thời (State Locking & Encryption)
- **Object Versioning:** Bật versioning trên GCS bucket để có thể rollback state nếu bị lỗi.
- **KMS Encryption:** Mã hóa state file ở trạng thái nghỉ bằng Cloud KMS (Customer-Managed Encryption Keys - CMEK).
- **Native State Locking:** GCS tự động hỗ trợ object locking để ngăn chặn hai kỹ sư hoặc hai luồng CI/CD chạy lệnh `plan`/`apply` cùng một thời điểm, tránh race condition làm hỏng state.

---

## 4. Quản lý Phân quyền Đặc quyền Tối thiểu (Least Privilege IAM)

### 4.1. Nguyên tắc Không Dùng Quyền `roles/owner` hay `roles/editor`
Tuyệt đối không cấp các quyền primitive rộng như Owner hoặc Editor cho Service Account chạy CI/CD. Cấp đúng các IAM roles tối thiểu theo nguyên tắc phân quyền theo tác vụ:

| Service Account | Quyền hạn cần thiết (IAM Roles) | Mục đích sử dụng |
| :--- | :--- | :--- |
| `sa-ci-builder` | `roles/artifactregistry.writer`<br>`roles/viewer` | Đóng gói và push image lên Artifact Registry trong pipeline CI. |
| `sa-terraform-runner` | `roles/container.admin`<br>`roles/cloudsql.admin`<br>`roles/iam.serviceAccountUser` | Khởi tạo và quản lý hạ tầng GKE & Cloud SQL. |
| `sa-commerceflow-app` (GKE Workload Identity) | `roles/cloudsql.client`<br>`roles/secretmanager.secretAccessor` | Cho phép Pod của microservices kết nối Private Cloud SQL và đọc secrets từ Secret Manager mà không cần Service Account Key JSON. |

---

## 5. Quy trình Kiểm thử & An toàn: `fmt`, `validate`, `plan` vs. `apply`

### 5.1. Bảng so sánh Sự khác biệt Kỹ thuật

| Lệnh Terraform | Mục đích | Có thay đổi Cloud không? | Môi trường chạy an toàn |
| :--- | :--- | :---: | :--- |
| `terraform fmt -check` | Kiểm tra định dạng code HCL chuẩn xác. | **KHÔNG** | Local, Git Pre-commit, CI Pull Request |
| `terraform validate` | Kiểm tra cú pháp HCL, tính hợp lệ của biến và provider schema. | **KHÔNG** | Local, CI Pull Request |
| `terraform plan` | Đọc state hiện tại, so sánh với code và sinh kế hoạch thay đổi (Diff). | **KHÔNG** | CI Pull Request (kèm comment duyệt) |
| `terraform apply` | **Thực thi thay đổi thật trên cloud** (tạo, sửa, xóa tài nguyên). | **CÓ THAY ĐỔI** | **Chỉ chạy trên nhánh `main` SAU KHI CÓ PHÊ DUYỆT TRỰC TIẾP TỪ QUẢN TRỊ VIÊN.** |

### 5.2. Thử thách Độc lập: Tại sao `plan` khác `apply`?
- **Ví dụ Kịch bản:** 
  Một kỹ sư cấu hình sửa đổi thuộc tính không thể thay đổi tại chỗ của cơ sở dữ liệu Cloud SQL (ví dụ: đổi `database_version` từ `POSTGRES_15` sang `POSTGRES_16`).
- **Khi chạy `terraform plan`:** 
  Terraform phát hiện sự khác biệt và hiển thị ký hiệu `~ / -/+` cảnh báo rằng:
  `# module.cloud_sql.google_sql_database_instance.default must be replaced (forces replacement)`.
  Tại thời điểm này, **chưa có bất kỳ tác động nào xảy ra với database sản xuất**. Kỹ sư và Lead SRE có thể phát hiện ngay nguy cơ mất dữ liệu và dừng lại.
- **Nếu chạy nhầm `terraform apply`:** 
  Terraform sẽ ngay lập tức xóa bỏ (destroy) cụm Cloud SQL cũ và tạo một cụm mới, dẫn đến mất trắng toàn bộ dữ liệu giao dịch của khách hàng.

---

## 6. Đánh đổi Kỹ thuật (Trade-off): Rủi ro Lưu State chứa Secrets Công khai

- **Vấn đề cốt lõi:**
  Nhiều tài nguyên hạ tầng (như database passwords, private keys, service account credentials) khi được tạo ra qua Terraform sẽ được lưu trữ dưới dạng **plain text** bên trong tệp `terraform.tfstate`.
- **Rủi ro lớn:**
  Nếu commit `terraform.tfstate` lên Git repository công khai hoặc lưu trên GCS bucket mở quyền đọc (`allUsers` hoặc `allAuthenticatedUsers`), toàn bộ mật khẩu cơ sở dữ liệu sẽ bị lộ hoàn toàn.
- **Giải pháp bắt buộc của CommerceFlow:**
  1. Thêm `*.tfstate`, `*.tfstate.*`, và `.terraform/` vào tệp `.gitignore`.
  2. Bật chính sách GCP Organization Policy: Chặn public access trên GCS bucket (`enforcePublicAccessPrevention`).
  3. Sử dụng Google Secret Manager tích hợp để truyền mật khẩu thay vì hardcode trong Terraform inputs/outputs.

