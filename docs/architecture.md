# Kiến trúc CommerceFlow

## Giai đoạn 1: Modular Monolith
Một NestJS process gồm 4 modules: Catalog, Ordering, Inventory, Payments. Domain không import NestJS, Prisma hoặc HTTP.

## Giai đoạn 2: Microservices
React Web → API Gateway (authn/authz) → Catalog / Ordering / Inventory / Payments. Mỗi service sở hữu DB/schema và credentials. Ordering orchestration Saga qua event bus; transactional outbox và inbox chống dual-write/duplicate.

## Giai đoạn 3: Cloud Native
React static assets trên hosting phù hợp, backend chạy Cloud Run với authenticated service identities; Cloud SQL PostgreSQL, Pub/Sub push JWT, Secret Manager. GitHub Actions OIDC/WIF, Terraform plan/apply có approval; Cloud Logging/Monitoring/OpenTelemetry. GKE tạo riêng cho lab có teardown.

## Trật tự dependency sạch
Domain ← Application ← Infrastructure/Presentation (adapter); shared packages chỉ có contracts và infrastructure-neutral utilities.

## Nguồn quyết định
Đọc `docs/adr/ADR-001.md` đến `ADR-009.md`.

## Security/cost boundary
Không expose DB hoặc event handler vô điều kiện; private service ingress nếu phù hợp; IAM least privilege; không lưu service account JSON. Budget $50/month là mục tiêu thiết kế, không enforce spending cap. Phải ước lượng Cloud SQL + networking theo region trước apply.

---

[ANSWER]
# Phân tích ADRs, Yêu cầu Phi Chức Năng (NFRs) & Threat Model

## 1. Tổng hợp ADRs Cốt lõi & Chiến lược Modular Monolith First

Hệ thống CommerceFlow được kiến trúc dựa trên 9 biên bản quyết định kiến trúc (ADR-001 đến ADR-009):

### Chiến lược Modular Monolith First (ADR-001)
- **Quyết định:** Giai đoạn đầu xây dựng hệ thống dưới dạng **Modular Monolith** chạy trong một tiến trình duy nhất với 4 modules độc lập: `Catalog`, `Ordering`, `Inventory`, `Payments`.
- **Lý do:** Giảm thiểu chi phí điều phối mạng (network latency, partial failures, distributed tracing) trong khi tập trung định hình mô hình nghiệp vụ sạch (Clean Architecture).
- **Tiêu chí tách Microservices:** Chỉ tách thành dịch vụ Cloud Run độc lập khi đáp ứng một trong các điều kiện:
  1. *Đặc tính tải bất đối xứng:* Module `Ordering` hoặc `Catalog` có lượng truy cập tăng vọt cần scale độc lập mà không muốn tốn tài nguyên scale toàn bộ hệ thống.
  2. *Quyền tự chủ của nhóm (Team Autonomy):* Khi các nhóm kỹ sư độc lập tiếp quản từng Bounded Context và cần chu kỳ release riêng biệt.

---

## 2. Yêu cầu Phi Chức Năng (NFRs) & Quản trị Rủi ro Kỹ thuật

### A. Rủi ro Dữ liệu (Data Consistency & Dual-Write Prevention)
- **Vấn đề:** Khi Order Service vừa cập nhật DB vừa xuất bản sự kiện lên Pub/Sub, một trong hai thao tác có thể thất bại (Dual-write hazard), gây lệch dữ liệu giữa Ordering và Inventory.
- **Giải pháp bắt buộc:**
  - Áp dụng mẫu thiết kế **Transactional Outbox**: Bản ghi sự kiện được lưu cùng transaction ACID với entity vào bảng `outbox`. Một tiến trình nền (Outbox Relay) đọc và phát tán lên Pub/Sub.
  - Phía nhận áp dụng **Idempotent Consumer (Inbox Pattern)**: Lưu `eventId` vào bảng đã xử lý để bỏ qua các message trùng lặp (xử lý kịch bản R-04).

### B. Mô hình Đe dọa (Threat Model - STRIDE) & IAM Least Privilege
Phân tích an ninh hệ thống dựa trên mô hình STRIDE:
1. **Spoofing (Giả mạo danh tính):**
   - *Nguy cơ:* Kẻ tấn công giả mạo service nội bộ để gọi API trừ kho hoặc xác nhận đơn giả.
   - *Biện pháp:* 100% giao tiếp service-to-service qua Cloud Run được xác thực bằng Google IAM Service Account OIDC ID Tokens; API Gateway xác thực JWT chữ ký số từ Auth0/Firebase.
2. **Tampering (Can thiệp dữ liệu):**
   - *Nguy cơ:* Thay đổi payload đơn hàng hoặc sửa đổi giá trị tồn kho trên đường truyền.
   - *Biện pháp:* Ép buộc mã hóa TLS 1.3 cho toàn bộ traffic; Cloud SQL chỉ truy cập qua Private IP (Cloud SQL Auth Proxy/VPC), không expose public IP.
3. **Repudiation (Chối bỏ hành động):**
   - *Nguy cơ:* Người dùng hoặc dịch vụ từ chối việc đã tạo hoặc hủy một đơn hàng.
   - *Biện pháp:* Mọi request bắt buộc phải có `X-Correlation-ID` và được ghi nhật ký bất biến vào Cloud Logging và OpenTelemetry traces.
4. **Information Disclosure (Lộ lọt thông tin):**
   - *Nguy cơ:* Lộ mật khẩu database, token thanh toán qua source code hoặc log.
   - *Biện pháp:* Cấm lưu file JSON key của service account; toàn bộ secret được lưu trong Google Secret Manager và inject qua biến môi trường tại runtime; tuân thủ nguyên tắc **IAM Least Privilege**.
5. **Denial of Service (Từ chối dịch vụ - DoS):**
   - *Nguy cơ:* Bị spam request tạo đơn làm sập database hoặc nghẽn thread pool.
   - *Biện pháp:* Cấu hình Rate Limiting tại API Gateway; Cloud Run giới hạn concurrency và max instances để tránh chi phí leo thang.
6. **Elevation of Privilege (Leo thang đặc quyền):**
   - *Nguy cơ:* Tài khoản viewer gọi được endpoint ghi (write endpoint).
   - *Biện pháp:* Kiểm soát phân quyền dựa trên vai trò (RBAC) chặt chẽ tại Gateway (kịch bản R-06: viewer gọi write bị 403; thiếu token bị 401).

### C. Quản lý Ngân sách & Rủi ro Chi phí Cloud ($50/tháng)
- **Mục tiêu:** Kiểm soát chi phí vận hành đám mây cho môi trường lab trong ngưỡng **$50 USD/tháng**.
- **Biện pháp kiểm soát:**
  1. *Serverless Compute:* Dùng Cloud Run với cấu hình `min-instances = 0` (Scale-to-Zero khi không có request).
  2. *Cloud SQL:* Dùng tier phát triển nhỏ nhất (`db-f1-micro` hoặc `db-custom-1-3840`), tắt High Availability (multi-AZ) trong lab, lên lịch tự động tắt khi không học.
  3. *GKE Cluster:* Tuyệt đối không để cluster GKE chạy thường trực; chỉ tạo cluster dạng ephemeral khi thực hiện lab Kubernetes và teardown ngay lập tức.
  4. *Billing Alerts:* Thiết lập cảnh báo ngân sách tự động ở các mốc 50%, 80%, 100% qua Cloud Monitoring và Cloud Pub/Sub.

---

## 3. Thử thách Độc lập: Hai Trường hợp KHÔNG nên Tách Service

Trong thiết kế phần mềm, không phải lúc nào tách microservices cũng là lựa chọn tối ưu. Dưới đây là hai trường hợp cụ thể **không nên tách service**:

### Trường hợp 1: Hai module có mức độ gắn kết logic và thay đổi schema liên tục (High Co-change Coupling)
- **Bản chất:** Khi hai phần của hệ thống thường xuyên phải thay đổi cùng lúc trong mỗi yêu cầu nghiệp vụ (ví dụ: Module Giỏ hàng tạm thời và Module Khuyến mãi giảm giá thời gian thực).
- **Lý do không tách:**
  - Nếu tách ra 2 microservices độc lập, mỗi khi cập nhật nghiệp vụ đòi hỏi phải sửa đổi cả 2 repositories, chạy 2 pipelines CI/CD và phải thực hiện **Lockstep Deployment** (triển khai đồng thời cả 2 service để không gãy tương thích ngược).
  - Tách service trong trường hợp này phá vỡ tính độc lập triển khai (Independent Deployability) – vốn là lợi ích số 1 của microservices, nhưng lại phải chịu toàn bộ chi phí phức tạp của hệ phân tán.

### Trường hợp 2: Nghiệp vụ đòi hỏi tính nhất quán tức thời (Immediate ACID Consistency) và độ trễ siêu thấp
- **Bản chất:** Các giao dịch tài chính cốt lõi hoặc thao tác điều phối khóa tài nguyên chặt chẽ với tần suất cao (ví dụ: chuyển tiền nội bộ giữa 2 tài khoản, hoặc khớp lệnh chứng khoán).
- **Lý do không tách:**
  - Trong một process/database duy nhất, giao dịch được giải quyết nguyên tử bằng một ACID transaction của Postgres với thời gian khóa tính bằng mili-giây (< 2ms) và độ tin cậy tuyệt đối.
  - Nếu tách thành 2 microservices, hệ thống buộc phải chuyển sang mô hình Saga (Eventual Consistency) hoặc Two-Phase Commit (2PC) phân tán. Điều này làm tăng độ trễ lên gấp hàng chục lần, dễ dẫn đến hiện tượng deadlock phân tán và phức tạp hóa việc xử lý lỗi (cần hàng loạt logic bù trừ).

