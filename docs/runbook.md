# CommerceFlow Production Runbook & SRE Observability Guide

## 1. Giới thiệu & Mục tiêu
Tài liệu này xác định cẩm nang vận hành (Runbook), kiến trúc quan sát toàn diện (Observability: Tracing, Metrics, Structured Logging, Alerts), các chỉ số độ tin cậy dịch vụ (SLI/SLO/SLA), và quy trình ứng phó sự cố (Incident Response) cho nền tảng phân tán **CommerceFlow**.

> [!IMPORTANT]
> **CẢNH BÁO BẢO MẬT & QUY TẮC CLOUD (ZERO CLOUD CREATION & PII PROTECTION):**
> - Mọi thành phần kiểm thử trong tài liệu này được xác thực và mô phỏng trên môi trường cục bộ. **Tuyệt đối KHÔNG tạo hay cấu hình tài nguyên Cloud Logging / Monitoring thật trên GCP** khi chưa có phê duyệt chi phí.
> - **Quy tắc bảo mật PII/Token:** Hệ thống log tuyệt đối **KHÔNG ĐƯỢC GHI** (Zero-Leakage) các thông tin định danh cá nhân nhạy cảm (PII: mật khẩu, số thẻ tín dụng, số CCCD) hoặc Security Tokens (Bearer Tokens, API Keys, Private Keys).

---

## 2. Kiến trúc Truy vết Phân tán (Distributed Tracing with Correlation ID)

### 2.1. Chuẩn hóa Định dạng Correlation ID (Khớp Micro-lab)
Trong hệ thống microservices (API Gateway $\to$ Order Service $\to$ Inventory Service $\to$ Payment Gateway), mỗi request/event bắt buộc phải mang một mã truy vết duy nhất:
- Định dạng chuẩn: `trace-order-{UUID}` hoặc `trace-{SERVICE}-{TIMESTAMP}-{HASH}` (Bắt buộc bắt đầu bằng tiền tố `trace-`).
- HTTP Header: `X-Correlation-ID` hoặc W3C `traceparent`.
- Event Metadata: `event.metadata.correlationId`.

### 2.2. Luồng Truy vết Xuyên Dịch vụ (Cross-Service Trace Flow)
```
[Client / Browser]
       │
       ▼ (HTTP POST /orders) [X-Correlation-ID: trace-order-o1]
[API Gateway]
       │ ──> Log: [trace-order-o1] Request received for customer CUST-123
       ▼ (Call internal gRPC/HTTP)
[Order Service (Saga Orchestrator)]
       │ ──> Log: [trace-order-o1] Starting Saga for Order ORD-999
       │ ──> Event: OrderCreatedEvent { metadata: { correlationId: "trace-order-o1" } }
       ▼ (Event Bus / PubSub)
[Inventory Service Consumer]
       │ ──> Log: [trace-order-o1] Reserving stock for Order ORD-999 (SKU: IPHONE-15-PRO)
       │ ──> Event: InventoryReservedEvent { metadata: { correlationId: "trace-order-o1" } }
       ▼
[Payment Simulator Consumer]
       └──> Log: [trace-order-o1] Charging payment $1,400 for Order ORD-999
```

---

## 3. Chỉ số Độ tin cậy (SLI / SLO / SLA) & Dashboard Giám sát

Hệ thống CommerceFlow áp dụng bộ 4 tín hiệu vàng SRE (Four Golden Signals: Latency, Traffic, Errors, Saturation):

| Thành phần | Chỉ số SLI (Service Level Indicator) | Mục tiêu SLO (30 ngày) | Cam kết SLA (Khách hàng) |
| :--- | :--- | :---: | :---: |
| **Availability (Tính sẵn sàng)** | Tỷ lệ request thành công:<br>`Count(2xx, 3xx, 4xx) / Count(Total Requests)` | **$\ge$ 99.9%** (Tối đa 43.8 phút downtime/tháng) | **$\ge$ 99.5%** |
| **Latency (Độ trễ API)** | 95th Percentile (p95) độ trễ phản hồi của API Gateway | **$\le$ 200 ms** cho luồng đọc<br>**$\le$ 500 ms** cho luồng đặt hàng Saga | **$\le$ 1000 ms** |
| **Order Saga Success Rate** | Tỷ lệ Saga hoàn tất (Confirmed hoặc Clean Compensated) | **$\ge$ 99.95%** (Không bị treo pending quá 60s) | **$\ge$ 99.9%** |
| **Error Rate (Tỷ lệ lỗi 5xx)** | Số lỗi HTTP 5xx / Tổng số request | **$\le$ 0.1%** | **$\le$ 0.5%** |

---

## 4. Thiết kế Cảnh báo Thông minh Chống Nhiễu (Alert Fatigue Mitigation)

### 4.1. Thử thách Độc lập: Thiết kế Alert Tránh Báo Động Giả (Anti-Noise Alert)
- **Vấn đề báo động giả (Alert Fatigue):**
  Nếu đặt cảnh báo tức thì ngay khi có 1 lỗi 500 xuất hiện hoặc khi CPU chạm 80% trong 1 giây, SRE team sẽ nhận hàng trăm thông báo email/Slack mỗi ngày. Dần dần, các cảnh báo này bị phớt lờ, và khi sự cố thật xảy ra sẽ không ai phản ứng.
- **Tiêu chuẩn Cảnh báo Bền vững của CommerceFlow:**
  Áp dụng công thức đa điều kiện dựa trên tỷ lệ lỗi (Error Budget Burn Rate) và thời gian duy trì liên tục:
  ```yaml
  alert: HighApiErrorRate
  expr: |
    (sum(rate(http_requests_total{status=~"5.."}[5m])) 
     / 
     sum(rate(http_requests_total[5m]))) > 0.02
  for: 3m
  labels:
    severity: critical
    team: sre-core
  annotations:
    summary: "API Gateway 5xx error rate exceeds 2% continuously for 3 minutes"
    runbook_url: "docs/runbook.md#incident-response"
  ```
  - **Quy tắc chống nhiễu (Negative check):**
    1. Lỗi phải duy trì liên tục trong ít nhất 3 phút (`for: 3m`).
    2. Lưu lượng tổng thể phải đạt ngưỡng tối thiểu ($N \ge 100$ requests) để tránh trường hợp chỉ có 1 request duy nhất bị lỗi 500 trong lúc hệ thống rảnh rỗi cũng gây báo động.

---

## 5. Quy tắc Đánh đổi Kỹ thuật (Trade-off): Rò rỉ Thông tin Cá nhân trong Log (PII / Token Leaking)

### 5.1. Rủi ro Nghiêm trọng
- Khi lập trình viên log toàn bộ request payload (`console.log(req.body, req.headers)`), các thông tin cực kỳ nhạy cảm như:
  - Header: `Authorization: Bearer eyJhbGci...`
  - Body: `password`, `cardNumber`, `cvv`, `email`, `phone`
  sẽ bị ghi thẳng vào file log và đồng bộ lên Cloud Logging / Datadog / ElasticSearch.
- Bất kỳ ai có quyền đọc log đều có thể chiếm đoạt tài khoản người dùng hoặc lấy cắp thẻ tín dụng, vi phạm nghiêm trọng luật bảo vệ dữ liệu (GDPR, PCI-DSS).

### 5.2. Bộ lọc Dữ liệu Tự động (PII Masking Sanitizer)
Mọi logger trong CommerceFlow bắt buộc phải đi qua lớp middleware lọc bỏ/ẩn dấu dữ liệu nhạy cảm:
```typescript
const SENSITIVE_KEYS = ['password', 'token', 'authorization', 'secret', 'cardNumber', 'cvv'];

export function sanitizeLogData(data: Record<string, any>): Record<string, any> {
  const sanitized = { ...data };
  for (const key of Object.keys(sanitized)) {
    if (SENSITIVE_KEYS.some(sensitive => key.toLowerCase().includes(sensitive.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeLogData(sanitized[key]);
    }
  }
  return sanitized;
}
```

---

## 6. Quy trình Ứng phó Sự cố (Incident Response Runbook Steps)

1. **Bước 1: Nhận diện & Truy vết (Triage with Correlation ID)**
   - Lấy `correlationId` từ báo cáo người dùng hoặc log lỗi.
   - Tìm kiếm toàn bộ hành trình trên hệ thống log: `jsonPayload.correlationId = "trace-order-xxx"`.
2. **Bước 2: Phân loại Sự cố**
   - Sự cố DB/Pod: Kiểm tra Readiness / Liveness probe.
   - Sự cố Dead-Letter: Kiểm tra hàng đợi Pub/Sub DLQ.
   - Sự cố Saga: Kiểm tra bảng Saga Orchestration xem có đơn hàng nào bị treo trạng thái `PENDING` quá 60s hay không.
3. **Bước 3: Khắc phục Khẩn cấp (Mitigation)**
   - Nếu bản build mới gây lỗi $\to$ Thực hiện rollback tức thì về revision/digest trước đó (`kubectl rollout undo` hoặc `gcloud run services update-traffic`).
   - Nếu bão sự kiện lỗi $\to$ Bật Circuit Breaker cách ly dịch vụ thanh toán.
4. **Bước 4: Hậu kiểm & Dọn dẹp (Post-mortem & Billing Audit)**
   - Ghi nhận nguyên nhân gốc (Root Cause Analysis - RCA).
   - Kiểm tra danh mục tài nguyên cloud đảm bảo không có tài nguyên rò rỉ phát sinh chi phí.
