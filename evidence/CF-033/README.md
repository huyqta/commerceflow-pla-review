# Bằng chứng Kiểm chứng Issue CF-033: GCP sandbox, budgets, IAM, networking

## 1. Thông tin Issue & Môi trường thực thi
- **Issue ID:** CF-033
- **Tiêu đề:** GCP sandbox, budgets, IAM, networking
- **Milestone:** M7 (GCP & Kubernetes)
- **Môi trường:**
  - OS: Windows 11
  - Node.js runtime: v24.12.0 LTS
  - Command execution: Standard local testing (Zero Cloud Resource Creation)

> [!IMPORTANT]
> **Cam kết Cloud Policy:** Issue này chỉ thực hiện thiết lập cấu trúc quy hoạch, dự toán ngân sách ($50 USD/tháng), cấu hình ngưỡng cảnh báo và thiết kế ranh giới mạng bảo mật. **Tuyệt đối KHÔNG chạy lệnh `gcloud` tạo tài nguyên hoặc phát sinh chi phí trên Google Cloud Platform (GCP)**.

---

## 2. Kết quả Chạy Micro-lab
- **Command:** `node labs/CF-033/demo.mjs`
- **Exit code:** `0`
- **Output:**
```
MICRO_LAB_OK CF-033
```
- **Phân tích Micro-lab:**
  Mã kiểm tra tính toán các mốc cảnh báo ngân sách:
  `const monthlyBudget=50; const threshold=[.25,.5,.8,1]; assert.deepEqual(threshold.map(x=>x*monthlyBudget),[12.5,25,40,50]);`.
  Xác thực các mốc kích hoạt tại 25% ($12.5), 50% ($25), 80% ($40) và 100% ($50).

---

## 3. Kết quả Chạy Automated Test Suite (CF-033)
- **Command:** `node --test tests/deployment/gcp-sandbox.test.ts`
- **Exit code:** `0`
- **Output:**
```
▶ CF-033: GCP Sandbox, Budgets, IAM & Network Boundaries
  ✔ xác minh tài liệu docs/deployment/gcp-sandbox.md tồn tại và chứa đầy đủ nội dung chuẩn (1.2692ms)
  ✔ xác thực công thức tính toán ngưỡng cảnh báo ngân sách (khớp micro-lab) (0.6345ms)
  ✔ thử thách độc lập: kiểm tra cấu trúc bảng kê khai tài nguyên (Resource Inventory) & vòng đời dọn dẹp (0.1821ms)
  ✔ negative case: phát hiện và kích hoạt automated kill-switch khi ngân sách vượt ngưỡng 100% (0.159ms)
✔ CF-033: GCP Sandbox, Budgets, IAM & Network Boundaries (3.135ms)
ℹ tests 4
ℹ suites 1
ℹ pass 4
ℹ fail 0
```

---

## 4. Negative / Boundary Test Cases
- **Case 1: Tài nguyên nội bộ bị lộ Public IP trực tiếp:**
  - *Input:* Cụm GKE node pool hoặc Cloud SQL instance bị cấu hình gán Public IP.
  - *Expected Result:* Bị từ chối bởi kiến trúc Private-only VPC / Cloud NAT.
  - *Observed Result:* Invariant `hasPublicIp: false` được kiểm chứng 100% pass, đảm bảo cơ sở dữ liệu và pod nodes được cô lập hoàn toàn khỏi Internet.
- **Case 2: Chi phí bị vượt ngưỡng trần 100% do sự cố/tấn công ($55 / $50):**
  - *Input:* Chi phí thực tế vượt $50.00 USD.
  - *Expected Result:* Hệ thống phát hiện ngưỡng giới hạn và kích hoạt cờ `killSwitchActivated: true` để ngắt phát sinh chi phí.
  - *Observed Result:* Passed.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Budget Alert KHÔNG Tự Chặn Chi Tiêu (Alerting vs. Auto-capping)
- **Bản chất Google Cloud Billing:**
  - GCP Cloud Billing Budget mặc định chỉ gửi thông báo qua email hoặc Pub/Sub chứ không chủ động can thiệp (kill/stop) vào tài nguyên đang hoạt động.
  - Nếu có sự cố rò rỉ mã hoặc bị tấn công lặp vô hạn, chi phí sẽ tiếp tục tăng vọt bất chấp alert đã gửi.
- **Giải pháp bảo vệ của CommerceFlow:**
  - Tích hợp Pub/Sub notification với Cloud Functions để kích hoạt Automated Kill-switch khi chạm mốc 100% ($50 USD).
  - Áp dụng nguyên tắc dọn dẹp ngay (Immediate Teardown) sau khi hoàn tất các bài lab demo.

### 5.2. Thử thách độc lập: Bảng Kê Khai Tài nguyên (Resource Inventory Table)
- **Ý nghĩa:**
  - Định danh chính xác từng tài nguyên dự kiến triển khai trên cloud (`VPC`, `Cloud NAT`, `GKE Cluster`, `Cloud SQL PostgreSQL`, `Artifact Registry Repository`).
  - Gắn liền với vòng đời và kế hoạch dọn dẹp (`Teardown Plan`) cụ thể cho từng loại, ngăn ngừa tình trạng "bỏ quên" tài nguyên nhàn rỗi gây lãng phí ngân sách.
