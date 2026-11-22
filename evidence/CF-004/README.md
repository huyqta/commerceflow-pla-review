# Evidence CF-004

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 9ccda58f8d16a9c15905f142ee7b7fee8d72d5bc
- Commands / exit codes:
  - Command: `node labs/CF-004/demo.mjs`
  - Output: `MICRO_LAB_OK CF-004 (Đã kiểm chứng thực tế docs/ddd/context-map.md thành công)`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử: Chạy validator khi tài liệu thiếu thành phần `Policy` trong Event Storming hoặc chưa thể hiện luồng phát sinh sự kiện.
  - Lệnh kiểm chứng: `node labs/CF-004/demo.mjs` (trước khi cập nhật đầy đủ docs).
  - Observed Output: `AssertionError [ERR_ASSERTION]: Thất bại: Thiếu thành phần "Policy" trong mô tả Event Storming!`
  - Exit code: `1`
  - Giải thích: Validator kiểm tra thực tế cấu trúc tài liệu, ngăn chặn việc nghiệm thu thiếu các thành phần điều phối nghiệp vụ.

[ANSWER]
## 1. Trade-off: Nhầm lẫn giữa Bảng Cơ sở Dữ liệu (Database Table) và Bounded Context

Trong quá trình phân rã Microservices theo DDD, lỗi kiến trúc phổ biến nhất là **Data-Driven Decomposition** (tách dịch vụ dựa trên các bảng database thay vì ranh giới nghiệp vụ):

- **Bản chất của sự nhầm lẫn:**
  - Lập trình viên thường coi mỗi bảng trong cơ sở dữ liệu cũ (ví dụ bảng `orders`, `products`, `inventory`, `payments`) tương ứng với một microservice.
  - Hậu quả: Dẫn đến mô hình **Anemic Domain Services** (các service chỉ đóng vai trò là tầng CRUD bọc ngoài database). Các service này bị phụ thuộc chặt chẽ với nhau qua các khóa ngoại (Foreign Keys) phân tán. Khi muốn tạo đơn hàng, Ordering Service phải gọi synchronous HTTP GET sang Catalog để lấy thông tin sản phẩm, gọi Inventory để kiểm tra stock, tạo ra luồng mạng dạng "mạng nhện" (distributed dependency web).
- **Cách tiếp cận đúng của Domain-Driven Design (DDD):**
  - **Bounded Context là ranh giới của một Mô hình Ngôn ngữ Chung (Ubiquitous Language):** Cùng một thực thể vật lý (sản phẩm) sẽ có các ý nghĩa nghiệp vụ hoàn toàn khác nhau ở từng context:
    - Trong *Catalog Context*: Sản phẩm là thông tin quảng bá, mô tả, hình ảnh hiển thị cho khách xem.
    - Trong *Ordering Context*: Sản phẩm chỉ là một dòng hóa đơn (`OrderLineItem`) lưu trữ snapshot giá tại thời điểm chốt đơn, không quan tâm mô tả chi tiết.
    - Trong *Inventory Context*: Sản phẩm là đơn vị lưu kho (`SKU/StockUnit`) gắn với số lượng thực tế trên giá kệ và trạng thái đặt trước.
  - Bằng cách phân tách theo Bounded Context, mỗi service sở hữu trọn vẹn mô hình logic và dữ liệu cần thiết của nó, giao tiếp phi tập trung qua Events mà không cần chắp vá các bảng DB với nhau.

---

## 2. Thử thách độc lập: Vẽ luồng `InventoryReserved` được sinh ra ở đâu?

### Sơ đồ luồng phát sinh và phân phối sự kiện `InventoryReserved`:

```
[Ordering Service]                                  [Google Cloud Pub/Sub]                                 [Inventory Service]
        |                                                     |                                                      |
        | 1. SubmitOrder (Command)                            |                                                      |
        | 2. Lưu Order (PENDING)                              |                                                      |
        | 3. Ghi Outbox (OrderPlaced)                         |                                                      |
        | 4. Outbox Relay đẩy Event                           |                                                      |
        |---------------------------------------------------->|                                                      |
        |                                                     | 5. Pull/Push Message                                 |
        |                                                     |----------------------------------------------------->|
        |                                                     |                                                      | 6. Nhận OrderPlaced
        |                                                     |                                                      | 7. Kích hoạt Policy:
        |                                                     |                                                      |    Whenever OrderPlaced
        |                                                     |                                                      |    Then ReserveInventory
        |                                                     |                                                      | 8. Aggregate StockItem
        |                                                     |                                                      |    kiểm tra invariant:
        |                                                     |                                                      |    stock >= requested
        |                                                     |                                                      | 9. Trừ available_stock
        |                                                     |                                                      | 10. SINH RA SỰ KIỆN:
        |                                                     |                                                      |     InventoryReserved
        |                                                     |                                                      | 11. Ghi Outbox cục bộ
        |                                                     | 12. Relay xuất bản                                   |
        |                                                     |<-----------------------------------------------------|
        |                                                     |
        | 13. Lắng nghe InventoryReserved                     |
        |<----------------------------------------------------|
        | 14. Ordering/Payment tiếp tục Saga:                 |
        |     Whenever InventoryReserved                      |
        |     Then ProcessPayment                             |
        v                                                     v
```

### Kết luận chính:
1. **Nơi sinh ra:** Sự kiện `InventoryReserved` được **sinh ra duy nhất tại Inventory Bounded Context** bởi Aggregate Root `StockItem` sau khi transaction trừ tồn kho cục bộ thành công.
2. **Quyền sở hữu (Ownership):** Inventory Context sở hữu toàn quyền đối với schema và ngữ nghĩa của `InventoryReserved`. Ordering Service hay Payment Service chỉ đóng vai trò là bên tiêu thụ (Subscriber/Consumer).

### Phép thử chứng minh (Verification Test):
- Đoạn mã assertion độc lập chứng minh luồng chuyển giao quyền sở hữu:
  ```javascript
  import assert from 'node:assert/strict';

  // Giả lập Event Bus trung gian
  class EventBus {
    constructor() { this.handlers = new Map(); }
    subscribe(event, handler) { this.handlers.set(event, handler); }
    publish(event, payload) {
      if (this.handlers.has(event)) return this.handlers.get(event)(payload);
    }
  }

  const bus = new EventBus();
  let inventoryStock = 10;
  let eventProduced = null;

  // Inventory Service đăng ký lắng nghe sự kiện từ Ordering
  bus.subscribe('OrderPlaced', (data) => {
    // Inventory Context sở hữu nghiệp vụ kiểm tra và trừ kho
    if (inventoryStock >= data.quantity) {
      inventoryStock -= data.quantity;
      // Sự kiện InventoryReserved được TẠO RA TẠI ĐÂY (Inventory Context)
      eventProduced = {
        eventName: 'InventoryReserved',
        originContext: 'Inventory',
        orderId: data.orderId,
        reservedQuantity: data.quantity,
      };
      bus.publish(eventProduced.eventName, eventProduced);
    }
  });

  // Ordering Context đăng ký nhận kết quả để tiếp tục thanh toán
  let paymentTriggered = false;
  bus.subscribe('InventoryReserved', (event) => {
    assert.equal(event.originContext, 'Inventory', 'Lỗi: Sự kiện không xuất phát từ Inventory Context!');
    paymentTriggered = true;
  });

  // Kích hoạt luồng
  bus.publish('OrderPlaced', { orderId: 'ORD-001', quantity: 3 });

  // Kiểm chứng
  assert.equal(inventoryStock, 7, 'Tồn kho phải giảm đi 3');
  assert.equal(eventProduced.eventName, 'InventoryReserved');
  assert.equal(eventProduced.originContext, 'Inventory');
  assert.ok(paymentTriggered, 'Payment phải được kích hoạt sau khi nhận InventoryReserved');
  console.log('PASS: Kiểm chứng luồng sinh sự kiện InventoryReserved thành công!');
  ```
