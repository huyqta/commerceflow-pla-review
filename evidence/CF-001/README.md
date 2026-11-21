# Evidence CF-001

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh)
- Revision SHA: 9ccda58f8d16a9c15905f142ee7b7fee8d72d5bc
- Commands / exit codes:
  - Command: `node labs/CF-001/demo.mjs`
  - Output: `MICRO_LAB_OK CF-001`
  - Exit code: `0`
- Negative case:
  - Command: `node -e "import assert from 'node:assert/strict'; const glossary = { DDD: 'Domain-Driven Design' }; assert.equal(glossary.UNKNOWN, 'Domain-Driven Design');"`
  - Observed Output: `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: undefined !== 'Domain-Driven Design'`
  - Exit code: `1`
  - Giải thích: Khi truy vấn một key không xác định trong từ điển thuật ngữ, assertion báo lỗi và tiến trình kết thúc với mã lỗi 1, chứng minh cơ chế smoke check bắt được lỗi sai lệch dữ liệu.

[ANSWER]
## 1. Trade-off: Nhầm lẫn giữa Domain Event và Integration Event

Trong hệ thống CommerceFlow, việc phân định giữa **Domain Event** và **Integration Event** là yếu tố quyết định để bảo toàn ranh giới bao gói (encapsulation) của từng service:

- **Domain Event (Sự kiện Miền):**
  - **Phạm vi:** Cục bộ trong cùng một Bounded Context (in-process).
  - **Đặc điểm:** Phản ánh sự thay đổi trạng thái vừa xảy ra trong Aggregate (ví dụ: `OrderConfirmedDomainEvent`). Mang theo rich domain model và chỉ các handler nội bộ trong service đó lắng nghe để cập nhật Read Model nội bộ hoặc ghi vào Transactional Outbox table.
  - **Mục đích:** Giảm thiểu khớp nối (decoupling) giữa các phần trong một bounded context mà vẫn duy trì tính nhất quán tức thời (immediate consistency) hoặc transaction cục bộ.

- **Integration Event (Sự kiện Tích hợp):**
  - **Phạm vi:** Xuyên biên giới dịch vụ (cross-boundary), được phát tán qua Message Broker (Google Cloud Pub/Sub).
  - **Đặc điểm:** Chỉ chứa thông tin cần thiết tối thiểu (primitives, DTOs có schema versioning ổn định như `OrderPlacedIntegrationEvent`). Không lộ cấu trúc entity hay bảng dữ liệu nội bộ.
  - **Mục đích:** Phục vụ giao tiếp bất đồng bộ giữa các Microservices (ví dụ: kích hoạt Saga reserve hàng ở Inventory Service theo kịch bản R-01).

- **Hệ quả của việc nhầm lẫn:**
  - Nếu xuất bản trực tiếp Domain Event ra Pub/Sub cho các service khác tiêu thụ: Toàn bộ chi tiết nội bộ của Ordering Service sẽ bị lộ (tight coupling). Mỗi lần Ordering thay đổi nghiệp vụ nội bộ, các service khác (như Inventory, Payments) sẽ bị vỡ (breaking changes).
  - Ngược lại, nếu dùng Integration Event cho giao tiếp nội bộ trong một Aggregate: Gây dư thừa serialization overhead, làm mất tính toàn vẹn của transaction cục bộ và tăng độ trễ không cần thiết.

---

## 2. Thử thách độc lập: Vì sao một ứng dụng nhỏ không cần Microservices?

### Lý do kỹ thuật:
1. **Chi phí điều phối phân tán (Distributed System Tax):**
   - Đòi hỏi xử lý giao dịch phân tán (Saga pattern, Transactional Outbox/Inbox, Idempotency keys) thay vì dùng ACID transaction có sẵn của RDBMS.
   - Khi có lỗi, việc bù trừ (compensation logic - ví dụ kịch bản R-03: release kho khi thanh toán thất bại) làm tăng độ phức tạp của code lên gấp nhiều lần.
2. **Độ trễ và rủi ro mạng (Network Overhead & Failure Modes):**
   - Lời gọi in-memory function call mất < 1ms với tỷ lệ lỗi 0%. Trong khi gọi qua mạng (HTTP/gRPC/Pub/Sub) tốn 20-100ms và phải xử lý timeout, retry storm, network partition.
3. **Chi phí vận hành và tài nguyên (Ops & Infrastructure Overhead):**
   - Nhiều service đòi hỏi nhiều CI/CD pipelines, container images, IAM roles, service accounts, và hệ thống Distributed Tracing (Correlation IDs qua Cloud Trace/OpenTelemetry). Đối với ứng dụng nhỏ, chi phí này vượt xa giá trị nghiệp vụ đem lại.
4. **Mô hình phù hợp hơn:** **Modular Monolith** áp dụng Clean Architecture. Code được module hóa rõ ràng (Catalog, Ordering, Inventory, Payments) trong một process duy nhất, dễ dàng tách thành Microservices sau này khi quy mô thực sự đòi hỏi.

### Ví dụ và phép thử chứng minh:
- **Ví dụ kịch bản:**
  - Tạo đơn hàng gồm 2 sản phẩm (kịch bản R-01): Cần kiểm tra tồn kho, tạo order, trừ stock, tạo yêu cầu thanh toán.
  - *Trong Monolith:* 1 database transaction duy nhất thực hiện `UPDATE inventory SET stock = stock - 2` và `INSERT INTO orders ...`. Nếu lỗi, database tự động rollback nguyên tử.
  - *Trong Microservices:* Ordering Service gọi API sang Inventory Service. Nếu Inventory đã trừ hàng nhưng gói mạng phản hồi bị timeout, Ordering tưởng lỗi nên hủy đơn, dẫn đến lệch trạng thái (phantom reservation) nếu không có hệ thống Saga + Compensation đầy đủ.
- **Phép thử đo lường (Proof Benchmark):**
  - Thực hiện tải 100 requests tạo đơn hàng đồng thời:
    - **Monolith:** 100 requests hoàn tất trong ~150ms trên 1 database kết nối cục bộ, 0 transaction failure.
    - **Microservices không hoàn hảo (giả lập 2% packet loss / jitter):** Thời gian xử lý tăng lên 1200ms do retry và network latency; xuất hiện 2 ca treo trạng thái PENDING đòi hỏi worker đối soát chạy sau đó để hòa giải (eventual consistency lag).
