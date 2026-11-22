# Kế hoạch Thiết lập GCP Sandbox, Quản lý Ngân sách, IAM và Ranh giới Mạng

## 1. Giới thiệu & Mục tiêu
Tài liệu này xác định kiến trúc môi trường thử nghiệm (Sandbox Environment) trên Google Cloud Platform (GCP) cho dự án **CommerceFlow**, bao gồm:
- Thiết lập cấu trúc dự án cách ly (Sandbox Isolation).
- Dự toán chi phí chi tiết (Cost Estimation) và chính sách cảnh báo ngân sách (Budget Alerts).
- Ranh giới mạng bảo mật (VPC Network Boundaries, Private Subnets, Cloud NAT).
- Phân quyền IAM đặc quyền tối thiểu (Least Privilege).
- Bảng kê tài nguyên (Resource Inventory Table).

> [!IMPORTANT]
> **CẢNH BÁO CHÍNH SÁCH TRIỂN KHAI CLOUD (ZERO CLOUD CREATION POLICY):**
> Tài liệu này được thiết lập phục vụ công tác lập kế hoạch, dự toán và kiểm thử logic. **Tuyệt đối KHÔNG chạy các lệnh `gcloud`, `terraform apply`, hoặc tạo bất kỳ tài nguyên thật nào trên GCP trong Issue này**. Khi hệ thống sẵn sàng và cần tạo tài nguyên thật trên GCP, kỹ sư phụ trách **BẮT BUỘC PHẢI THÔNG BÁO VÀ XIN PHÊ DUYỆT TRỰC TIẾP TỪ QUẢN TRỊ VIÊN**.

---

## 2. Thiết kế Môi trường Sandbox & Cách ly (GCP Sandbox Architecture)

### 2.1. Cấu trúc Resource Hierarchy
```
CommerceFlow Organization (commerceflow.internal)
└── Folder: Development & Learning
    └── Project: `commerceflow-sandbox-dev`
        ├── Billing Account: Liên kết với Billing Account riêng biệt có hạn mức.
        ├── VPC: `commerceflow-vpc-sandbox` (Custom mode VPC)
        └── Region: `asia-southeast1` (Singapore) - Độ trễ tối ưu cho người dùng Đông Nam Á.
```

### 2.2. Ranh giới Mạng Bảo mật (Network Boundaries & Firewall Rules)
Mô hình mạng VPC-native được thiết kế theo nguyên tắc Zero Trust nội bộ:
1. **Private-Only Subnet:**
   - Dải IP Primary: `10.10.0.0/20` (cho GKE Nodes và Compute instances).
   - Dải IP Secondary 1: `10.20.0.0/16` (GKE Pod CIDR).
   - Dải IP Secondary 2: `10.30.0.0/20` (GKE Service CIDR).
2. **Cloud NAT Gateway:** Cung cấp kết nối Internet ra ngoài (egress) an toàn cho các Pods tải dependencies/patches mà **không cấp Public IP** cho bất kỳ node nào.
3. **Private Service Connect / Private IP cho Cloud SQL:** Database PostgreSQL chỉ phản hồi trong mạng nội bộ VPC qua peering `10.40.0.0/24`. Tuyệt đối chặn Public IP trên Cloud SQL.
4. **Firewall Rules:**
   - `deny-all-ingress-default`: Chặn toàn bộ traffic vào từ Internet ngoại trừ qua HTTPS Load Balancer (Port 443).
   - `allow-internal-mesh`: Chỉ cho phép giao tiếp nội bộ giữa các microservices qua các cổng được cấp phép (3000-3004).

---

## 3. Dự toán Chi phí & Chính sách Ngân sách (Budgets & Cost Estimation)

### 3.1. Bảng Dự toán Chi phí Hàng tháng (Monthly Cost Estimate)
Mức ngân sách trần quy định: **$50.00 USD / tháng**.

| Tài nguyên GCP | Cấu hình / Thông số | Chi phí ước tính / tháng | Ghi chú tối ưu |
| :--- | :--- | :---: | :--- |
| **GKE Standard / Autopilot** | 1 cluster (Autopilot mode hoặc 2 nodes `e2-medium` preemptible/spot) | ~$25.00 | Tắt cluster ngoài giờ làm việc hoặc dùng Spot VMs. |
| **Cloud SQL for PostgreSQL** | Instance `db-f1-micro` (Shared core, 10 GB SSD, Private IP) | ~$10.00 | Dùng cho môi trường dev, có thể tắt qua Cloud Scheduler. |
| **Cloud NAT & Egress** | 1 Cloud NAT Gateway + egress traffic nội vùng | ~$4.00 | Hạn chế outbound traffic không cần thiết. |
| **Artifact Registry** | Container images storage (< 10 GB) | ~$1.00 | Tự động dọn dẹp các untagged/old images. |
| **Cloud Logging & Monitoring** | Logs ingestion (< 5 GB/tháng free tier) | ~$2.00 | Lọc bớt log mức `debug` khi đẩy lên Cloud Logging. |
| **Phụ phí dự phòng (Buffer)** | Cloud Storage backup, Public IP allocation | ~$8.00 | Đảm bảo không vượt trần tổng chi phí. |
| **TỔNG CỘNG DỰ KIẾN** | | **$50.00 USD** | Nằm trong ngưỡng an toàn cho phép. |

### 3.2. Cấu hình Ngưỡng Cảnh báo Ngân sách (Budget Alert Thresholds)
Ngân sách cơ sở: **$50 USD / tháng**.
Các mốc cảnh báo tự động gửi thông báo qua Email và Google Cloud Pub/Sub:

| Ngưỡng (%) | Chi phí kích hoạt | Hành động tương ứng |
| :---: | :---: | :--- |
| **25%** | **$12.50 USD** | Gửi email thông báo định kỳ: Chi phí đang tăng trưởng theo kế hoạch. |
| **50%** | **$25.00 USD** | Gửi email cảnh báo: Đã đạt nửa chu kỳ chi phí, kiểm tra các tài nguyên nhàn rỗi. |
| **80%** | **$40.00 USD** | Gửi email khẩn cấp (High Priority): Kiểm tra nguy cơ vượt ngân sách. |
| **100%** | **$50.00 USD** | Gửi thông báo tới Cloud Pub/Sub: Kích hoạt Cloud Function tắt các tài nguyên không cốt lõi. |

---

## 4. Phân quyền IAM Đặc quyền Tối thiểu (Least Privilege IAM)

| Định danh (Principal) | Role được cấp | Phạm vi (Scope) |
| :--- | :--- | :--- |
| `developer-sandbox@commerceflow.internal` | `roles/viewer`<br>`roles/container.developer` | Chỉ được xem tài nguyên và deploy Pods trong namespace sandbox. |
| `sa-gke-workload-sandbox` | `roles/cloudsql.client`<br>`roles/secretmanager.secretAccessor` | Pod chỉ được đọc secret cấu hình và kết nối database. |
| **Các quyền bị cấm tuyệt đối:** | `roles/owner`, `roles/editor`, `roles/resourcemanager.organizationAdmin` | Ngăn chặn hành vi leo thang đặc quyền. |

---

## 5. Thử thách Độc lập: Bảng Kê Khai Tài nguyên (Resource Inventory Table)

Mục đích: Thiết lập danh mục tài nguyên chi tiết trước khi triển khai, giúp kiểm soát trạng thái vòng đời (Lifecycle) và có kịch bản dọn dẹp (Teardown) tức thì.

| ID Tài nguyên | Loại tài nguyên (Resource Type) | Mục đích nghiệp vụ | Kịch bản Dọn dẹp (Teardown Plan) |
| :--- | :--- | :--- | :--- |
| `vpc-sandbox-01` | `google_compute_network` | Mạng riêng VPC cách ly cho toàn bộ dịch vụ. | Giữ lại cấu hình, không phát sinh chi phí khi không có traffic. |
| `nat-sandbox-01` | `google_compute_router_nat` | Kết nối Internet cho Private GKE Nodes. | Xóa bỏ khi ngừng chạy test (`terraform destroy -target=module.nat`). |
| `gke-sandbox-cluster` | `google_container_cluster` | Nền tảng chạy microservices container. | Tắt/Hủy ngay sau khi hoàn thành buổi demo nghiệm thu. |
| `sql-sandbox-pg` | `google_sql_database_instance` | Lưu trữ dữ liệu Order, Inventory, Catalog. | Tạo snapshot sao lưu, sau đó hủy instance khi không dùng. |
| `gar-sandbox-repo` | `google_artifact_registry_repository` | Lưu trữ Docker container images. | Giữ lại các images có tag version, xóa digest cũ. |

---

## 6. Đánh đổi Kỹ thuật (Trade-off): Budget Alert KHÔNG Tự Chặn Chi Tiêu (Alerting vs. Auto-capping)

- **Bản chất của Google Cloud Budget:**
  Theo mặc định, dịch vụ Cloud Billing Budget chỉ là hệ thống **thông báo (Alerting system)**. Khi chi phí chạm mốc 100% ($50 USD), GCP **không tự động tắt các máy ảo hoặc dịch vụ**. Nếu người quản trị không can thiệp, hệ thống vẫn tiếp tục chạy và chi phí sẽ tiếp tục phát sinh không giới hạn.
- **Rủi ro:**
  Nếu một Pod bị tấn công đào tiền ảo (crypto mining) hoặc gặp lỗi vòng lặp vô hạn (infinite loop) gọi API, hóa đơn có thể nhảy vọt lên hàng nghìn USD dù đã đặt alert.
- **Giải pháp kiểm soát bắt buộc của CommerceFlow:**
  1. Tích hợp Cloud Budget với **Cloud Pub/Sub** và **Cloud Functions (Automated Kill-switch)**: Khi nhận sự kiện chi phí chạm 100%, Function tự động gọi API gỡ bỏ Billing Account khỏi Project hoặc tắt cụm GKE Node Pool.
  2. Bắt buộc dọn dẹp (Teardown) cụm GKE ngay sau mỗi buổi lab/demo để triệt tiêu phụ phí nhàn rỗi.
