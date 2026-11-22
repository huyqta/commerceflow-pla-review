# Chiến Lược Phục Hồi, Retry Có Giới Hạn, Dead-Letter Queue & Kỹ Thuật Bơm Lỗi (Resilience & Retry Scenarios)

**Dự án:** CommerceFlow Cloud-Native Platform  
**Phiên bản:** 1.0.0  
**Tài liệu tham chiếu:** [docs/requirements.md](../../docs/requirements.md), [docs/architecture.md](../../docs/architecture.md), [docs/glossary.md](../../docs/glossary.md)

---

## 1. Giới thiệu & Mục tiêu Kiến trúc Phục hồi (Resilience)

Trong một hệ thống phân tán hướng sự kiện (EDA / Microservices) chạy trên nền tảng điện toán đám mây (Google Cloud Run, Cloud Pub/Sub), lỗi mạng, quá tải dịch vụ hoặc sập container tạm thời là điều tất yếu.

### Các mục tiêu cốt lõi:
1. **Bounded Exponential Backoff with Jitter:** Ngăn chặn hiện tượng thắt cổ chai và bão request (Thundering Herd / Retry Storm) khi một dịch vụ phụ thuộc vừa hồi phục.
2. **Phân biệt Lỗi Tạm thời (Transient) và Lỗi Vĩnh viễn (Permanent):**
   - **Lỗi Tạm thời (Transient Error):** Mất kết nối mạng tạm thời, lỗi HTTP `503 Service Unavailable`, `429 Too Many Requests`, DB connection timeout. $\to$ **Được phép Retry**.
   - **Lỗi Vĩnh viễn (Permanent Error / Poison Pill):** Lỗi dữ liệu `400 Bad Request`, `401 Unauthorized`, `409 Conflict`, JSON parse error, schema validation error. $\to$ **Tuyệt đối cấm Retry**, đẩy ngay vào Dead-Letter Queue.
3. **Dead-Letter Queue (DLQ) & Cơ chế Replay:** Đảm bảo không mất dữ liệu; các thông điệp độc hại hoặc vượt quá số lần retry tối đa sẽ được chuyển vào DLQ để kỹ sư đối soát và phát lại (Replay) sau khi sửa lỗi.
4. **Failure Injection (Kiểm thử Hỗn loạn - Chaos Engineering):** Chủ động bơm lỗi vào môi trường test để đo lường khả năng tự phục hồi (Self-healing) và tính toàn vẹn của dữ liệu.

---

## 2. Thiết kế Bounded Exponential Backoff & Jitter

### 2.1. Công thức Toán học
Khoảng thời gian chờ giữa các lần thử lại (Backoff Delay) được tính toán theo công thức:

$$\text{Delay}(a) = \min\left(\text{InitialDelay} \times 2^a, \text{MaxDelay}\right) + \text{Jitter}$$

Trong đó:
- $a$: Số lần đã thử lại (attempt count: $0, 1, 2, \dots, \text{MaxAttempts}$).
- $\text{InitialDelay} = 100\,\text{ms}$.
- $\text{MaxDelay} = 5000\,\text{ms}$ (Ngưỡng chặn trên - Bounded Upper Limit).
- $\text{Jitter} = \text{random}(0, \text{FullJitterRange})$: Độ trễ ngẫu nhiên để làm phân tán thời điểm gửi lại của hàng loạt clients.

```
Lần thử 0: 100ms
Lần thử 1: 200ms
Lần thử 2: 400ms
Lần thử 3: 800ms
Lần thử 4: 1600ms
Lần thử 5: 3200ms
Lần thử >= 6: 5000ms (Max bounded)
```

---

## 3. Phân biệt Lỗi Tạm thời (Transient) và Lỗi Vĩnh viễn (Permanent)

Bảng phân loại hành vi xử lý lỗi cho các Microservices trong CommerceFlow:

| Loại Lỗi | Mã Lỗi / Ngoại Lệ | Bản chất Kỹ thuật | Hành vi Xử lý | Đẩy vào DLQ? |
|---|---|---|---|:---:|
| **Transient** | `ECONNRESET`, `ETIMEDOUT` | Mạng gián đoạn tạm thời giữa các pods | Retry có Backoff (Tối đa 3 lần) | Nếu vượt 3 lần |
| **Transient** | HTTP `503`, HTTP `504` | Service đích đang khởi động lại hoặc quá tải | Retry có Backoff + Jitter | Nếu vượt 3 lần |
| **Transient** | HTTP `429 Too Many Requests` | Bị Rate Limit tạm thời bởi Cloud Gateway | Chờ theo header `Retry-After` rồi retry | Nếu vượt 3 lần |
| **Permanent** | HTTP `400 Bad Request` | DTO không hợp lệ, thiếu trường bắt buộc | **KHÔNG RETRY** (Fail-fast) | **Đẩy vào DLQ ngay** |
| **Permanent** | HTTP `401`, `403` | Token sai, chữ ký giả mạo, sai quyền RBAC | **KHÔNG RETRY** (Security Reject) | Không retry |
| **Permanent** | HTTP `409 Conflict` | Xung đột nghiệp vụ (Trùng SKU, Hết hàng) | **KHÔNG RETRY** (Business Logic) | Không retry |
| **Permanent** | `JSON_PARSE_ERROR` | Thông điệp bị hỏng (Poison Pill) | **KHÔNG RETRY** (Tránh vòng lặp vô hạn) | **Đẩy vào DLQ ngay** |

---

## 4. Kiến trúc Dead-Letter Queue (DLQ) & Cơ chế Replay

```
  [Message Broker (Pub/Sub)]
              │
              ▼
    [Consumer Worker]
              │
         (Xử lý?) ─────────── [Thành công] ──> [Commit ACK & Ghi Inbox]
              │
         (Thất bại)
              │
       (Phân loại Lỗi)
        /          \
   (Transient)    (Permanent / Poison Pill)
      /              \
 (Retry < 3 lần)      \
   /                    \
[Exponential Backoff]    \
   │                      \
(Thất bại >= 3 lần)        \
   │                        \
   └─────────────────────────┴─────────► [DEAD-LETTER QUEUE (DLQ)]
                                                    │
                                         [Kiểm tra & Sửa lỗi (Fix Bug)]
                                                    │
                                         [Replay Worker / CLI Tool]
                                                    │
                                                    ▼
                                         [Đẩy lại Main Topic an toàn]
```

### Các thuộc tính của Dead-Letter Record:
- `originalMessageId`: Khóa sự kiện ban đầu (`eventId`).
- `originalTopic`: Tên topic chính.
- `payload`: Toàn bộ nội dung dữ liệu JSON.
- `failureReason`: Thông điệp lỗi chi tiết và stack trace.
- `retryAttempts`: Số lần đã retry trước khi bị đẩy vào DLQ.
- `deadLetteredAt`: Thời điểm chuyển vào hàng đợi chết.

---

## 5. Kịch bản Bơm Lỗi (Failure Injection Scenarios)

Hệ thống được kiểm thử tự động với 4 kịch bản lỗi thực nghiệm:

### Kịch bản 1: Network Flakiness (Chập chờn mạng tạm thời)
- **Bơm lỗi:** Adapter mạng ném `ECONNRESET` ở lần gọi thứ 1 và thứ 2, sau đó thành công ở lần gọi thứ 3.
- **Kỳ vọng:** Worker retry 2 lần theo chuỗi backoff (100ms $\to$ 200ms), lần thứ 3 thành công $\to$ Giao dịch hoàn tất, **không** chuyển vào DLQ.

### Kịch bản 2: Poison Pill Message (Thông điệp độc hại / Lỗi cấu trúc)
- **Bơm lỗi:** Gửi một thông điệp có `totalAmount: -999` hoặc payload không phải JSON hợp lệ.
- **Kỳ vọng:** Validator nhận diện đây là Permanent Error $\to$ Ngắt retry ngay lập tức, chuyển thẳng vào DLQ với lý do `PERMANENT_VALIDATION_ERROR`.

### Kịch bản 3: Service Outage Vượt Ngưỡng (Max Retries Exhausted)
- **Bơm lỗi:** Payment Gateway bị sập hoàn toàn (trả về `503 Service Unavailable` liên tục 10 lần).
- **Kỳ vọng:** Worker chỉ retry tối đa 3 lần (Bounded Retries), sau đó dừng lại và chuyển vào DLQ kèm log cảnh báo $\to$ Không gây tràn bộ nhớ hay nghẽn luồng xử lý.

### Kịch bản 4: Replay từ DLQ sau khi khắc phục sự cố
- **Kịch bản:** Sau khi service thanh toán hồi phục, kích hoạt `replayDeadLetter(messageId)`.
- **Kỳ vọng:** Thông điệp được lấy ra khỏi DLQ, đưa lại vào hàng đợi chính, và được Consumer xử lý thành công nhờ tính chất Idempotent.

