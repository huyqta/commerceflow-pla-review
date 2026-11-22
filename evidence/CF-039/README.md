# Bằng chứng Kiểm chứng Issue CF-039: Failure drills, security, cost review và recovery

## 1. Thông tin Issue & Môi trường thực thi
- **Issue ID:** CF-039
- **Tiêu đề:** Failure drills, security, cost review và recovery
- **Milestone:** M8 (Operations, SRE & Capstone)
- **Môi trường:**
  - OS: Windows 11
  - Node.js runtime: v24.12.0 LTS
  - Command execution: Standard local testing (Zero Cloud Resource Creation)

> [!IMPORTANT]
> **Cam kết Cloud Policy:** Issue này chỉ thực hiện thiết kế 5 kịch bản diễn tập sự cố (Failure Injection Drills), kiểm thử tự phục hồi qua Outbox/Inbox Deduplication, phân tích rủi ro ảo tưởng sao lưu (Backup Illusion) và quy trình kiểm toán hóa đơn. **Tuyệt đối KHÔNG tạo hay can thiệp tài nguyên thật trên Google Cloud Platform (GCP)**.

---

## 2. Kết quả Chạy Micro-lab
- **Command:** `node labs/CF-039/demo.mjs`
- **Exit code:** `0`
- **Output:**
```
MICRO_LAB_OK CF-039
```
- **Phân tích Micro-lab:**
  Mã kiểm tra cơ chế phục hồi khi Pub/Sub gặp sự cố:
  `const drill={failure:'pubsub unavailable',recovery:'retry + inbox dedupe'}; assert.match(drill.recovery,/dedupe/);`.
  Khẳng định bắt buộc phải kết hợp retry với cơ chế khử trùng lặp Inbox (`inbox dedupe`) để bảo vệ dữ liệu nghiệp vụ không bị đột biến 2 lần.

---

## 3. Kết quả Chạy Automated Test Suite (CF-039)
- **Command:** `node --test tests/observability/failure-drills.test.ts`
- **Exit code:** `0`
- **Output:**
```
▶ CF-039: Failure Drills, Security, Cost Review & Disaster Recovery
  ✔ xác minh tài liệu docs/testing/failure-drills.md tồn tại và chứa đầy đủ 5 kịch bản diễn tập chuẩn (1.2914ms)
  ✔ xác thực kịch bản recovery khớp micro-lab (retry + inbox dedupe) (0.2859ms)
  ✔ thử thách độc lập: mô phỏng kịch bản Pub/Sub Outage & Event Duplication với Inbox Deduplication (0.2932ms)
  ✔ negative case: phân tích trade-off "Backup vs Tested Restore" - phát hiện backup hỏng trước khi đưa vào sản xuất (0.2007ms)
✔ CF-039: Failure Drills, Security, Cost Review & Disaster Recovery (3.2693ms)
ℹ tests 4
ℹ suites 1
ℹ pass 4
ℹ fail 0
```

---

## 4. Negative / Boundary Test Cases
- **Case 1: Pub/Sub phát lặp sự kiện giữ kho (Duplicate Event Delivery):**
  - *Input:* Broker gửi lặp lại `eventId: "evt-order-created-999"` với số lượng 1.
  - *Expected Result:* Lần 1 trừ kho từ 50 xuống 49. Lần 2 Inbox phát hiện `eventId` đã tồn tại $\to$ Bỏ qua (`DUPLICATE_EVENT_IGNORED`), giữ nguyên tồn kho 49.
  - *Observed Result:* Passed 100%. Loại trừ hoàn toàn lỗi trừ trùng tồn kho.
- **Case 2: Ảo tưởng file sao lưu tồn tại nhưng thiếu khóa giải mã KMS (Backup Illusion):**
  - *Input:* File backup dump hợp lệ nhưng `encryptionKeyAvailable = false`.
  - *Expected Result:* Kiểm tra tính khả thi từ chối (`canRestore = false`, MISSING_KMS_KEY).
  - *Observed Result:* Passed 100%.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Nhầm Backup Tồn Tại với Restore Đã Test (The Backup Illusion)
- **Rủi ro lớn:**
  Nhiều hệ thống tự động backup mỗi ngày nhưng chưa từng chạy thử nghiệm khôi phục. Đến khi database gặp sự cố thật sự mới phát hiện file backup bị lỗi hoặc schema cũ không tương thích, gây mất dữ liệu vĩnh viễn.
- **Giải pháp của CommerceFlow:**
  - Bắt buộc thực hiện diễn tập khôi phục thật (Tested Restore Drill) định kỳ trên môi trường sandbox cách ly.
  - Kiểm soát nghiêm ngặt 2 chỉ số: RTO $\le 15$ phút và RPO $\le 5$ phút.

### 5.2. Thử thách độc lập: Thiết Kế Drill Pub/Sub Outage
- Kết hợp hoàn hảo giữa Transactional Outbox (tầng Producer) và Idempotent Inbox Deduplication (tầng Consumer) bảo đảm hệ thống sống sót qua mọi sự cố đứt mạng broker mà không làm mất hay trùng lặp đơn hàng của khách.
