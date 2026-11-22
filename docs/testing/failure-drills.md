# Kịch bản Diễn tập Sự cố, Bảo mật, Đánh giá Chi phí & Khôi phục (Failure Drills & Disaster Recovery)

## 1. Giới thiệu & Mục tiêu
Tài liệu này xác định kịch bản diễn tập sự cố chủ động (Chaos Engineering / Failure Injection Drills), quy trình khôi phục thảm họa (Disaster Recovery - DR), kiểm toán an ninh bảo mật và đánh giá chi phí (Billing Audit) cho nền tảng phân tán **CommerceFlow**.

> [!IMPORTANT]
> **CẢNH BÁO QUY TẮC CLOUD (GCP POLICY):**
> Toàn bộ các kịch bản diễn tập tiêm lỗi (Failure Injection) và kiểm thử khôi phục được thực hiện an toàn trên môi trường local/test thông qua các mocks, test harnesses và Docker cục bộ. **Tuyệt đối KHÔNG chạy các kịch bản phá hủy hay tạo tài nguyên phát sinh chi phí trên Google Cloud Platform (GCP)** khi chưa có sự phê duyệt trực tiếp từ Quản trị viên.

---

## 2. Ma trận 5 Kịch bản Diễn tập Sự cố (Failure Drills Matrix)

| Drill ID | Tên Sự cố (Failure Scenario) | Điểm Tiêm Lỗi (Injection Point) | Cơ chế Tự Phục hồi (Recovery Mechanism) | Tiêu chí Nghiệm thu (Success Criteria) |
| :---: | :--- | :--- | :--- | :--- |
| **DRILL-01** | **Pub/Sub Broker Gián đoạn** | Broker ngắt kết nối trong 15s | Outbox Publisher giữ trạng thái `PENDING`, tự động retry sau khi Broker sống lại | Không mất event; Inbox Consumer khử trùng lặp (`inbox dedupe`) chống xử lý 2 lần (Khớp Micro-lab) |
| **DRILL-02** | **Cơ sở dữ liệu sập trong Outbox Poll** | Database connection timeout | Transaction rollback, Worker chờ Exponential Backoff | Không sinh dữ liệu rác; không gây thanh toán trùng |
| **DRILL-03** | **Cổng Thanh toán Bị Lỗi (Payment Crash)** | Payment Gateway trả về 500 hoặc Timeout | Saga Orchestrator kích hoạt bồi hoàn giải phóng tồn kho (`COMPENSATING_INVENTORY`) | Kho được nhả về đúng số lượng ban đầu, đơn hàng chuyển `CANCELLED` |
| **DRILL-04** | **Bản Deploy Cloud Run Bị Lỗi (Memory Leak)** | Revision mới làm tăng tỷ lệ lỗi 5xx | Instant Traffic Shifting: Điều hướng 100% traffic về revision cũ | Phục hồi trong < 2 giây, Zero Downtime |
| **DRILL-05** | **GKE Pod CrashLoopBackOff** | Container ném ngoại lệ không bắt được | Kubernetes Deployment tự động restart; Liveness/Readiness probes cách ly traffic | Không có request người dùng bị rơi vào Pod chết |

---

## 3. Thử thách Độc lập: Thiết kế Drill "Pub/Sub Outage & Event Duplication"

### 3.1. Kịch bản Thử thách
1. **Pha 1 (Broker Outage):** Khi Pub/Sub Broker bị gián đoạn mạng đột ngột trong 10 giây, Order Service vẫn tiếp tục nhận đơn hàng từ khách.
   - *Hành vi hệ thống:* Sự kiện `OrderCreated` được lưu an toàn trong bảng `Transactional Outbox` cùng transaction với bản ghi Order.
2. **Pha 2 (Broker Recovery):** Broker phục hồi kết nối. Outbox Publisher quét các sự kiện chưa gửi và phát lại vào hàng đợi.
3. **Pha 3 (At-least-once & Duplicate Delivery):** Do cơ chế phát lại mạng, Broker phát sự kiện `OrderCreated` **2 lần liên tiếp** tới Inventory Service.
4. **Pha 4 (Inbox Deduplication):**
   - Lần 1: Inventory Service xử lý, lưu `eventId` vào bảng `inbox`, trừ tồn kho khả dụng từ 50 xuống 49.
   - Lần 2: Inventory Service nhận thấy `eventId` đã tồn tại trong `inbox` $\to$ **Bỏ qua ngay lập tức (`inbox dedupe`)**, không trừ kho lần thứ hai.
   - *Kết quả:* Tồn kho cuối cùng được bảo toàn chính xác tuyệt đối là 49 (chống hoàn toàn overselling và double reservation).

---

## 4. Phân tích Đánh đổi Kỹ thuật (Trade-off): Ảo Tưởng Bản Sao Lưu (Backup vs. Tested Restore Illusion)

- **Vấn đề cốt lõi:**
  Nhiều tổ chức tự tin rằng hệ thống an toàn vì đã bật chế độ sao lưu tự động hàng ngày trên Cloud SQL hoặc GCS (`backup_configuration { enabled = true }`).
- **Thảm họa thực tế (The Backup Illusion):**
  - **"Có bản sao lưu $\neq$ Có khả năng khôi phục"**.
  - Rất nhiều trường hợp khi thảm họa xảy ra mới phát hiện: file backup bị hỏng (corrupted), thiếu khóa giải mã KMS (missing decryption key), schema database mới không tương thích với script restore cũ, hoặc thời gian restore (RTO) mất 24 giờ trong khi SLA cam kết là 30 phút.
- **Tiêu chuẩn Bắt buộc của CommerceFlow:**
  1. Định kỳ mỗi quý phải chạy **Drill Khôi phục Thật (Tested Restore Drill)** trên môi trường Sandbox/Staging cách ly.
  2. Đo lường chính xác hai chỉ số SRE:
     - **RTO (Recovery Time Objective):** Thời gian từ lúc bấm lệnh restore đến khi ứng dụng sẵn sàng nhận request phải $\le 15$ phút.
     - **RPO (Recovery Point Objective):** Mất mát dữ liệu tối đa chấp nhận được $\le 5$ phút giao dịch qua cơ chế Write-Ahead Logging (WAL) / Point-in-time Recovery (PITR).

---

## 5. Quy trình Kiểm toán Chi phí (Billing Audit & Ghost Resource Cleanup)

Sau mỗi buổi diễn tập sự cố hoặc kiểm thử hạ tầng, kỹ sư trực bắt buộc phải chạy checklist kiểm toán:
1. **Kiểm tra Compute & GKE:** Xác nhận không còn cluster thử nghiệm nào đang chạy ngầm (`gcloud container clusters list`).
2. **Kiểm tra Mạng & IP Tĩnh:** Kiểm tra các Forwarding Rules và External IP mồ côi (`gcloud compute forwarding-rules list`, `gcloud compute addresses list`).
3. **Kiểm tra Storage & Database:** Xác nhận các snapshot thử nghiệm không bị nhân bản vô tội vạ.
4. **Kiểm tra Dashboard Chi phí:** Đảm bảo chi phí phát sinh trong ngày nằm trong hạn mức dự toán $0.50 USD cho mỗi phiên lab.
