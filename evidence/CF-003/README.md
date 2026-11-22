# Evidence CF-003

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 9ccda58f8d16a9c15905f142ee7b7fee8d72d5bc
- Commands / exit codes:
  - Command: `node labs/CF-003/demo.mjs`
  - Output: `MICRO_LAB_OK CF-003 (Đã kiểm chứng đầy đủ các kịch bản BDD trong docs/requirements.md)`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử: Chạy validator khi tài liệu thiếu kịch bản đơn hàng có 2 sản phẩm.
  - Lệnh kiểm chứng: `node labs/CF-003/demo.mjs` (trước khi bổ sung kịch bản R-07/R-08).
  - Observed Output: `AssertionError [ERR_ASSERTION]: Thất bại: Chưa có kịch bản BDD cho "Đơn hàng có 2 sản phẩm" (Thử thách độc lập của CF-003)!`
  - Exit code: `1`
  - Giải thích: Validator kiểm tra thực tế cấu trúc tài liệu, ngăn chặn việc nghiệm thu thiếu yêu cầu kỹ thuật độc lập.

[ANSWER]
## 1. Trade-off: Rủi ro khi không định nghĩa được tiêu chí quan sát (Lack of Observable Criteria)

Trong kiến trúc hướng sự kiện (Event-Driven Architecture) và Microservices bất đồng bộ, việc thiếu tiêu chí quan sát cụ thể (observable exit criteria) dẫn đến các rủi ro hệ thống nghiêm trọng:

- **Vấn đề cốt lõi:**
  - Trong hệ thống phân tán, một API request tạo đơn hàng trả về `202 Accepted` hoặc `201 Created` kèm trạng thái `PENDING` chỉ chứng minh hệ thống đã tiếp nhận yêu cầu, **không chứng minh nghiệp vụ đã hoàn thành**.
  - Nếu kịch bản kiểm thử chỉ kiểm tra HTTP status trả về mà không quan sát trạng thái cuối cùng (trạng thái bản ghi trong DB Ordering, DB Inventory, message trên Pub/Sub), hệ thống sẽ gặp hiện tượng **False Success (Báo thành công giả)** trong khi các worker xử lý nền phía sau bị treo hoặc rơi vào Dead-Letter Queue (DLQ).
- **Hệ quả của việc thiếu tiêu chí quan sát:**
  - Khách hàng thấy đơn báo thành công trên giao diện, nhưng thực tế kho chưa trừ hoặc thanh toán thất bại mà không có cơ chế bồi hoàn.
  - Đội ngũ phát triển không thể viết được automated end-to-end acceptance tests vì không có mốc đo lường rõ ràng để assert (ví dụ: polling trạng thái DB đến khi đạt `CONFIRMED` hay `CANCELLED`).
- **Giải pháp chuẩn hóa cho CommerceFlow:**
  - Mọi kịch bản BDD (Given/When/Then) bắt buộc phải định nghĩa **3 lớp tiêu chí quan sát**:
    1. *Lớp giao diện/API:* HTTP response code & correlationId.
    2. *Lớp dữ liệu bền vững (State):* Trạng thái cụ thể trong bảng database của từng service (`Order.status`, `Inventory.available_stock`).
    3. *Lớp truyền thông phân tán (Events):* Danh sách integration events cụ thể được xuất bản lên Google Cloud Pub/Sub (`OrderPlaced`, `InventoryReserved`, `PaymentCaptured`).

---

## 2. Thử thách độc lập: Kịch bản đơn hàng có 2 sản phẩm (Atomic Multi-item Reservation)

### Bài toán:
Khách hàng đặt cùng lúc 2 mặt hàng: Sản phẩm A và Sản phẩm B trong một đơn hàng duy nhất. Cần đảm bảo tính nguyên tử (Atomicity): Hoặc là cả 2 sản phẩm cùng được giữ hàng thành công, hoặc không sản phẩm nào bị trừ hàng (All-or-Nothing).

### Kịch bản kiểm thử BDD (R-07 & R-08):
- **Trường hợp thành công (R-07):**
  - **Given:** Sản phẩm A có `stock = 5`, Sản phẩm B có `stock = 10`.
  - **When:** Đặt 2 sản phẩm A và 3 sản phẩm B.
  - **Then:** Đơn chuyển `PENDING` $\rightarrow$ `CONFIRMED`. Tồn kho A còn 3, tồn kho B còn 7.
- **Trường hợp một sản phẩm không đủ hàng (R-08 - Partial Failure):**
  - **Given:** Sản phẩm A có `stock = 5` (đủ hàng), nhưng Sản phẩm B chỉ có `stock = 1` (yêu cầu đặt 2).
  - **When:** Gửi request tạo đơn hàng gồm 2 sản phẩm A và 2 sản phẩm B.
  - **Then:**
    1. Request bị từ chối (`REJECTED`) với mã lỗi `422 Unprocessable Entity` (Chi tiết: `INSUFFICIENT_STOCK_FOR_PRODUCT_B`).
    2. **Business Invariant:** Tồn kho sản phẩm A **giữ nguyên 5**, tuyệt đối không bị giữ dở dang (không xảy ra partial reservation). Tồn kho sản phẩm B giữ nguyên 1.
    3. Không có sự kiện yêu cầu thanh toán nào được phát sinh.

### Phép thử chứng minh (Verification Test):
- **Mã kiểm thử logic nguyên tử (Executable Assertion):**
  ```javascript
  import assert from 'node:assert/strict';

  function reserveInventory(inventory, items) {
    // 1. Kiểm tra điều kiện tiên quyết cho toàn bộ mặt hàng trước khi trừ
    for (const item of items) {
      const stock = inventory.get(item.productId) || 0;
      if (stock < item.quantity) {
        throw new Error(`INSUFFICIENT_STOCK: ${item.productId}`);
      }
    }
    // 2. Chỉ thực hiện trừ đồng loạt khi TẤT CẢ sản phẩm đều thỏa mãn (Atomicity)
    for (const item of items) {
      const stock = inventory.get(item.productId);
      inventory.set(item.productId, stock - item.quantity);
    }
    return true;
  }

  // Khởi tạo tồn kho ban đầu
  const inventory = new Map([['A', 5], ['B', 1]]);
  const orderItems = [{ productId: 'A', quantity: 2 }, { productId: 'B', quantity: 2 }];

  // Thực hiện phép thử
  assert.throws(
    () => reserveInventory(inventory, orderItems),
    /INSUFFICIENT_STOCK: B/
  );

  // Chứng minh tính bất biến: Sản phẩm A KHÔNG bị trừ dở dang
  assert.equal(inventory.get('A'), 5, 'Lỗi Invariant: Sản phẩm A đã bị trừ dở dang!');
  assert.equal(inventory.get('B'), 1, 'Lỗi Invariant: Tồn kho B bị sai lệch!');
  console.log('PASS: Phép thử tính nguyên tử đơn hàng 2 sản phẩm thành công!');
  ```
