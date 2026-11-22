# Evidence CF-005

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 9ccda58f8d16a9c15905f142ee7b7fee8d72d5bc
- Commands / exit codes:
  - Command: `node labs/CF-005/demo.mjs`
  - Output: `MICRO_LAB_OK CF-005 (Đã kiểm chứng thực tế docs/architecture.md thành công)`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử: Chạy validator khi tài liệu kiến trúc chưa có nội dung phân tích Threat Model hoặc IAM Least Privilege.
  - Lệnh kiểm chứng: `node labs/CF-005/demo.mjs` (trước khi cập nhật đầy đủ docs).
  - Observed Output: `AssertionError [ERR_ASSERTION]: Thất bại: Thiếu phân tích mô hình đe dọa (Threat Model) hoặc kiểm soát IAM Least Privilege!`
  - Exit code: `1`
  - Giải thích: Validator kiểm tra trực tiếp các yêu cầu phi chức năng và tiêu chí an ninh, ngăn chặn việc nghiệm thu giả tạo.

[ANSWER]
## 1. Trade-off: Chọn công nghệ trước khi có tiêu chí quyết định (Resume-Driven Development / Tech-First Trap)

Trong các dự án phần mềm, sai lầm phổ biến nhất của kỹ sư là chọn công nghệ (Microservices, Kubernetes, Kafka, NoSQL) vì sự hào nhoáng trước khi xác định rõ các ràng buộc và tiêu chí quyết định (Decision Criteria):

- **Hệ quả của việc chọn công nghệ trước:**
  - **Tăng chi phí vô ích:** Thiết lập cụm Kubernetes (GKE) và cụm Pub/Sub phân tán cho một hệ thống chỉ có vài chục đơn hàng/ngày làm chi phí đám mây vượt ngưỡng $50/tháng mà không mang lại bất kỳ giá trị nào cho khách hàng.
  - **Over-engineering:** Làm phát sinh hàng loạt bài toán phụ trợ phức tạp (Distributed tracing, service mesh, two-phase commit, outbox patterns) làm chậm tiến độ ra mắt tính năng sản phẩm (Time-to-Market).
- **Nguyên tắc kỹ thuật đúng đắn trong CommerceFlow:**
  - Luôn áp dụng mẫu **ADR (Architecture Decision Record)**: Nêu rõ Bối cảnh (Context), Ràng buộc (Constraints), Các phương án thay thế (Alternatives), và Hệ quả đánh đổi (Trade-offs) trước khi lựa chọn công nghệ.
  - Bắt đầu với **Modular Monolith First**: Giữ cho việc phát triển và kiểm thử đơn giản nhất ở mức local, chỉ dịch chuyển sang các công nghệ phân tán khi các chỉ số đo lường thực tế (metrics, bottleneck, throughput) chứng minh sự cần thiết.

---

## 2. Thử thách độc lập: Hai trường hợp KHÔNG nên tách service

### Phân tích hai trường hợp:
1. **Trường hợp 1 — High Co-change Coupling (Mức độ thay đổi cùng nhau cao):**
   - Hai thành phần thường xuyên thay đổi logic và cấu trúc dữ liệu song song (ví dụ: giỏ hàng tạm thời và công thức tính chiết khấu linh hoạt).
   - *Hậu quả nếu tách:* Dẫn đến hiện tượng "Distributed Monolith" – hệ thống vẫn mang đầy đủ sự phụ thuộc lẫn nhau nhưng lại phải chịu thêm độ trễ mạng và rủi ro triển khai đồng bộ (Lockstep Deployment).
2. **Trường hợp 2 — High-Throughput & Immediate ACID Requirement (Nghiệp vụ đòi hỏi nhất quán tức thời với thông lượng cao):**
   - Các thao tác điều phối giao dịch nhạy cảm (ví dụ: chuyển tiền nội bộ hoặc trừ quỹ tín dụng trực tiếp).
   - *Hậu quả nếu tách:* Buộc phải chuyển từ 1 ACID transaction duy nhất sang Saga/2PC với thời gian khóa tài nguyên tăng từ vài mili-giây lên hàng trăm mili-giây, dễ xảy ra deadlock và race condition.

### Phép thử chứng minh (Verification Test):
- Đoạn mã assertion độc lập chứng minh sự suy giảm hiệu năng và rủi ro khi cố tình tách 2 thao tác có gắn kết chặt chẽ qua mạng so với gọi in-memory:
  ```javascript
  import assert from 'node:assert/strict';

  // 1. Mô hình Modular Monolith: Giao dịch ACID trong 1 process/transaction
  function transferMonolith(accountA, accountB, amount) {
    // Nguyên tử trong 1 transaction: hoàn tất trong microsecond
    if (accountA.balance < amount) throw new Error('INSUFFICIENT_FUNDS');
    accountA.balance -= amount;
    accountB.balance += amount;
    return { status: 'SUCCESS', latencyMs: 0.1 };
  }

  // 2. Mô hình Microservices giả định (gọi qua 2 dịch vụ độc lập với độ trễ mạng và rủi ro timeout)
  async function transferMicroservices(accountA, accountB, amount, simulateNetworkFailure = false) {
    if (accountA.balance < amount) throw new Error('INSUFFICIENT_FUNDS');
    accountA.balance -= amount; // Bước 1: Trừ tiền service A
    
    // Giả lập rủi ro mạng khi gọi sang service B
    if (simulateNetworkFailure) {
      // Service A đã trừ nhưng service B chưa nhận được -> Dữ liệu bị lệch (Cần Saga rollback)
      throw new Error('NETWORK_TIMEOUT_SERVICE_B');
    }
    accountB.balance += amount;
    return { status: 'SUCCESS', latencyMs: 50 }; // Độ trễ mạng ~50ms
  }

  // Chạy phép thử:
  const acc1 = { balance: 100 };
  const acc2 = { balance: 50 };

  // Monolith: Hoàn tất tức thì, an toàn tuyệt đối
  const monoResult = transferMonolith(acc1, acc2, 30);
  assert.equal(monoResult.status, 'SUCCESS');
  assert.equal(acc1.balance, 70);
  assert.equal(acc2.balance, 80);

  // Microservices khi gặp sự cố mạng:
  const acc3 = { balance: 100 };
  const acc4 = { balance: 50 };
  assert.rejects(
    async () => transferMicroservices(acc3, acc4, 30, true),
    /NETWORK_TIMEOUT_SERVICE_B/
  ).then(() => {
    // Chứng minh rủi ro lệch dữ liệu nếu thiếu hệ thống Saga phức tạp:
    assert.equal(acc3.balance, 70, 'Service A đã bị trừ tiền dở dang');
    assert.equal(acc4.balance, 50, 'Service B chưa nhận được tiền');
    console.log('PASS: Phép thử chứng minh rủi ro tách service khi cần tính nguyên tử chặt chẽ thành công!');
  });
  ```
