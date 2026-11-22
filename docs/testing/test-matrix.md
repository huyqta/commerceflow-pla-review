# Ma Trận Kiểm Thử Toàn Diện (Testing Matrix): Positive, Negative, Contract & Security

## 1. Giới thiệu & Mục tiêu
Tài liệu này xác định ma trận kiểm thử toàn diện của nền tảng **CommerceFlow Cloud-Native Platform**, bao hàm 4 khía cạnh trọng yếu:
1. **Positive Tests (Happy Paths):** Kiểm tra các luồng nghiệp vụ hoạt động đúng như thiết kế khi dữ liệu chuẩn.
2. **Negative & Boundary Tests:** Kiểm tra các điều kiện biên, dữ liệu không hợp lệ, lỗi mạng và cơ chế phòng vệ fail-safe.
3. **Consumer-Driven Contract Tests:** Đảm bảo tính tương thích ngược và phát hiện sớm các thay đổi phá vỡ hợp đồng (Breaking Changes) giữa các Microservices.
4. **Security & Threat Mitigation (OWASP & RBAC):** Kiểm tra phân quyền truy cập, xác thực danh tính JWT, chống rò rỉ secrets và chống các hành vi leo thang đặc quyền.

---

## 2. Bảng Ma Trận Phân Loại Kiểm Thử (Testing Matrix)

| STT | Mã Kịch Bản | Phân Loại | Phạm Vi (Scope) | Điều Kiện Thử Nghiệm / Payload | Kết Quả Kỳ Vọng (Invariants) | Test Suite Sở Hữu | Trạng Thái |
|:---:|:---:|:---:|:---:|---|---|---|:---:|
| 1 | **VAL-01** | Positive | Domain | Tạo Value Object Money, Quantity hợp lệ | Thực thể được khởi tạo bất biến (Immutable) | `tests/architecture/order-boundary.test.ts` | Pass |
| 2 | **VAL-02** | Negative | Domain Boundary | `quantity <= 0` hoặc giá trị thập phân | Ném `InvalidQuantityError`, từ chối tạo Order | `tests/architecture/order-boundary.test.ts` | Pass |
| 3 | **VAL-03** | Negative | Domain Boundary | `amount < 0` hoặc `NaN` | Ném `InvalidMoneyError`, bảo vệ bất biến tiền tệ | `tests/architecture/order-boundary.test.ts` | Pass |
| 4 | **VAL-04** | Negative | Domain Invariant | Đơn hàng không có sản phẩm (`items = []`) | Báo lỗi `EMPTY_ORDER_ITEMS` | `tests/architecture/order-boundary.test.ts` | Pass |
| 5 | **VAL-05** | Negative | Domain Invariant | Trùng lặp mã SKU trong cùng đơn hàng | Báo lỗi `DUPLICATE_ORDER_ITEM` | `tests/architecture/order-boundary.test.ts` | Pass |
| 6 | **STM-01** | Negative | State Machine | CANCEL đơn hàng đã CONFIRMED | Bị chặn, ném `InvalidStateTransitionError` | `tests/order/order-lifecycle.test.ts` | Pass |
| 7 | **STM-02** | Negative | State Machine | CONFIRM đơn hàng đã CANCELLED hoặc REJECTED | Bị chặn bởi State Machine Invariants | `tests/order/order-lifecycle.test.ts` | Pass |
| 8 | **CON-01** | Concurrency | Database Lock | 2 giao dịch đồng thời trừ kho khi tồn kho = 1 | Chỉ 1 giao dịch thành công, giao dịch sau nhận 409 Conflict | `tests/inventory/inventory-reservation.test.ts` | Pass |
| 9 | **SEC-01** | Security | AuthN (JWT) | Gọi API mà không có Authorization header | Trả về `401 Unauthorized` | `tests/api/catalog-api.test.ts` | Pass |
| 10 | **SEC-02** | Security | AuthZ (RBAC) | User vai trò `viewer` gọi lệnh ghi POST /products | Trả về `403 Forbidden` | `tests/api/catalog-api.test.ts`, `tests/e2e/order-flow.spec.ts` | Pass |
| 11 | **SEC-03** | Security | Token Tampering | Gửi token JWT bị sửa payload hoặc sai chữ ký | Trả về `401 Unauthorized: INVALID_SIGNATURE` | `tests/e2e/order-flow.spec.ts` | Pass |
| 12 | **SEC-04** | Security | Secrets Leakage | Quét image docker và mã nguồn tệp `.env` | File `.env` bị loại trừ 100% qua `.dockerignore` | `tests/docker/docker-health.test.ts` | Pass |
| 13 | **SEC-05** | Security | CI Permissions | Cấu hình GitHub Actions CI | Gán cứng `permissions: contents: read`, cấm `write-all` | `tests/ci/ci-pipeline.test.ts` | Pass |
| 14 | **CTR-01** | Contract | Microservices | OrderCreated V1 chứa `schemaVersion: 1`, `eventId`, `orderId` | Khớp Schema, consumer xử lý dữ liệu trơn tru | `tests/contracts/order-contract.test.ts` | Pass |
| 15 | **CTR-02** | Contract | Compatibility | OrderCreated V2 bổ sung optional field | Consumer cũ V1 vẫn đọc bình thường (Backward Compatible) | `tests/contracts/order-contract.test.ts` | Pass |
| 16 | **CTR-03** | Contract Breaking | Consumer Guard | Producer xóa trường bắt buộc `orderId` hoặc đổi kiểu dữ liệu | Consumer phát hiện vi phạm và ném `ContractValidationError` | `tests/testing/test-matrix.test.ts` | Pass |
| 17 | **MSG-01** | Messaging | Outbox Pattern | Lỗi broker sau khi commit database | Sự kiện nằm trong bảng outbox, được worker gửi lại sau | `tests/messaging/outbox-inbox.test.ts` | Pass |
| 18 | **MSG-02** | Messaging | Idempotent Inbox | Broker gửi lặp 2 lần cùng một `eventId` | Consumer chỉ thực thi side effect 1 lần duy nhất (R-04) | `tests/messaging/outbox-inbox.test.ts` | Pass |
| 19 | **RES-01** | Resilience | Error Handling | Lỗi mạng tạm thời `503` / `ECONNRESET` | Kích hoạt Bounded Exponential Backoff và thử lại | `tests/messaging/resilience-retry.test.ts` | Pass |
| 20 | **RES-02** | Resilience | Poison Pill | Thông điệp lỗi định dạng JSON hoặc Schema | Đẩy thẳng vào Dead-Letter Queue (DLQ), không retry vô hạn | `tests/messaging/resilience-retry.test.ts` | Pass |
| 21 | **RES-03** | Resilience | Dead-Letter Replay | Replay thông điệp từ DLQ vào Event Bus | Thông điệp được phát lại thành công, cập nhật `REPLAYED` | `tests/messaging/resilience-retry.test.ts` | Pass |
| 22 | **SGA-01** | Saga | Distributed Flow | Đủ hàng, thanh toán thành công (R-01) | Saga COMPLETED, đơn hàng chuyển CONFIRMED | `tests/order/order-saga.test.ts` | Pass |
| 23 | **SGA-02** | Saga | Out of Stock (R-02) | Tồn kho không đủ đáp ứng số lượng | Saga REJECTED, không trừ tiền, đơn REJECTED | `tests/order/order-saga.test.ts` | Pass |
| 24 | **SGA-03** | Saga | Compensation (R-03) | Thanh toán lỗi sau khi đã giữ kho | Kích hoạt luồng bồi hoàn (Release kho), đơn CANCELLED | `tests/order/order-saga.test.ts` | Pass |
| 25 | **SGA-04** | Saga | Timeout Recovery | Cổng thanh toán bị timeout quá hạn | Chuyển `PAYMENT_TIMED_OUT`, nhả kho và khôi phục Stale Sagas | `tests/order/order-saga.test.ts` | Pass |
| 26 | **UI-01** | Web UI | Routing & Shell | Người dùng truy cập đường dẫn không tồn tại | Render trang 404 Not Found kèm `role="alert"` | `tests/web/ui-shell.test.ts` | Pass |
| 27 | **UI-02** | Web UI | State Transitions | Khởi tạo đơn hàng trên giao diện | Ban đầu bắt buộc là `PENDING`, không bao giờ báo CONFIRMED sớm | `tests/web/order-page.test.ts` | Pass |
| 28 | **UI-03** | Web UI | Eventual Consistency | Đơn hàng chờ Saga xử lý quá ngưỡng polling | UI chuyển sang trạng thái `TIMEOUT`, ngắt polling | `tests/web/order-page.test.ts` | Pass |
| 29 | **INF-01** | Infrastructure | Docker Security | Chạy container môi trường Production | Chạy dưới Non-Root User (`USER nodejs`, UID 1001) | `tests/docker/docker-health.test.ts` | Pass |
| 30 | **INF-02** | Infrastructure | Health Probes | Database down trong khi process node vẫn chạy | Liveness báo `ALIVE`, nhưng Readiness báo `UNHEALTHY` | `tests/docker/docker-health.test.ts` | Pass |

---

## 3. Thử Thách Độc Lập: Kịch Bản Phá Vỡ Hợp Đồng (Consumer Contract Break Scenario)

### 3.1. Vấn đề thực tế trong kiến trúc Microservices
Khi Producer (ví dụ Order Service) thay đổi cấu trúc dữ liệu của sự kiện mà không thông báo hoặc không giữ tương thích ngược (ví dụ: đổi tên trường `orderId` thành `id`, hoặc đổi kiểu dữ liệu `amount` từ số thành chuỗi ký tự), các Consumer độc lập (Payment Service, Inventory Service, Analytics) sẽ bị sập hàng loạt trong runtime (**Poison Pill / Unhandled Exception**).

### 3.2. Cơ chế phòng vệ bằng Consumer Contract Validation
CommerceFlow áp dụng mẫu thiết kế **Consumer-Driven Contract**:
- Mỗi Consumer định nghĩa rõ ràng Schema kỳ vọng tối thiểu bao gồm: `schemaVersion`, danh sách các trường bắt buộc (`requiredFields`), và kiểu dữ liệu chuẩn.
- Khi nhận Envelope từ EventBus, Consumer chạy `validateContract(payload)` trước khi chuyển vào Domain Logic.
- Nếu phát hiện **Breaking Change** (thiếu `orderId` hoặc version không tương thích):
  1. Consumer ném lỗi nghiệp vụ rõ ràng: `ContractValidationError`.
  2. Phân loại lỗi thành `PERMANENT`.
  3. Cơ chế Resilience (CF-023) lập tức cô lập thông điệp vào **Dead-Letter Queue (DLQ)** để đội ngũ phát triển can thiệp, không để xảy ra bão retry làm tắc nghẽn Broker.

---

## 4. Trade-off: Ảo Tưởng Tỷ Lệ Bao Phủ Code (Code Coverage Illusion)
- **Hiểu lầm:** Đạt 100% Line Coverage đồng nghĩa với việc phần mềm không còn lỗi.
- **Thực tế:** Line coverage chỉ chứng minh rằng dòng code đó đã từng được bộ thông dịch đi qua một lần, hoàn toàn không chứng minh được tính đúng đắn của logic phân tán (Distributed Consistency), các trường hợp tranh chấp tài nguyên (Race Conditions), mất gói tin mạng, hoặc lỗi phân quyền RBAC.
- **Giải pháp của CommerceFlow:**
  - Tập trung vào **Semantic Boundary Testing** (Kiểm thử các bất biến nghiệp vụ lõi).
  - Kết hợp chặt chẽ giữa: Unit Tests cô lập $\to$ Contract Tests giữa các service $\to$ Resilience Failure Injections $\to$ E2E Integration Tests.
