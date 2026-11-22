# Evidence CF-007

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 9ccda58f8d16a9c15905f142ee7b7fee8d72d5bc
- Commands / exit codes:
  - Command: `node labs/CF-007/demo.mjs`
  - Output: `MICRO_LAB_OK CF-007 (Đã kiểm chứng thực tế Immutable Domain Event & Order States thành công)`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử 1: Cố tình can thiệp sửa đổi thuộc tính của Event sau khi khởi tạo:
    - Lệnh: `node -e "import('./apps/order-service/src/domain/events/order-created.ts').then(m => { const e = new m.OrderCreatedEvent('ord-1', { customerId: 'c1', items: [], totalAmount: 100, status: 'PENDING' }); e.orderId = 'hack'; })"`
    - Observed Output: `TypeError: Cannot assign to read only property 'orderId' of object '#<OrderCreatedEvent>'` (Exit code 1).
  - Tình huống kiểm thử 2: Cố tình sửa đổi payload con (Deep Freeze Check):
    - Lệnh: `node -e "import('./apps/order-service/src/domain/events/order-created.ts').then(m => { const e = new m.OrderCreatedEvent('ord-1', { customerId: 'c1', items: [], totalAmount: 100, status: 'PENDING' }); e.payload.totalAmount = 0; })"`
    - Observed Output: `TypeError: Cannot assign to read only property 'totalAmount' of object '#<Object>'` (Exit code 1).
  - Giải thích: Validator kiểm tra tính bất biến tuyệt đối của sự kiện nghiệp vụ trong quá khứ, ngăn ngừa việc can thiệp sửa đổi dữ liệu sau khi event phát sinh.

[ANSWER]
## 1. Trade-off: Rủi ro xuất bản Domain Event trước khi commit Database (Ghost Event / Dual-Write Hazard)

Trong kiến trúc hướng sự kiện, xuất bản sự kiện trực tiếp ra Message Broker (Google Cloud Pub/Sub) trước hoặc trong lúc giao dịch cơ sở dữ liệu chưa được `COMMIT` thành công là một lỗi thiết kế nghiêm trọng:

- **Bản chất của Ghost Event (Sự kiện ma):**
  1. Ordering Service bắt đầu transaction cơ sở dữ liệu để tạo đơn hàng.
  2. Ứng dụng vội vã gọi `pubsub.publish('OrderPlaced', order)` gửi ra ngoài.
  3. Sau đó, câu lệnh `db.commit()` bị thất bại (ví dụ: database lỗi kết nối, vi phạm unique constraint mã đơn, deadlock, hoặc sập nguồn tiến trình). Transaction bị rollback!
  4. **Hậu quả thảm khốc:** Bảng `orders` hoàn toàn không có đơn hàng đó, nhưng Inventory Service và Payment Service ở hạ nguồn đã nhận được sự kiện `OrderPlaced` và tiến hành trừ kho, quẹt thẻ khách hàng thành công. Khách hàng bị trừ tiền cho một đơn hàng không hề tồn tại trong cơ sở dữ liệu!
- **Giải pháp đúng đắn (Transactional Outbox Pattern):**
  - **Không bao giờ gọi network IO (Pub/Sub) trong transaction cơ sở dữ liệu.**
  - Lưu trạng thái Order và bản ghi Event vào cùng một cơ sở dữ liệu trong **một ACID transaction duy nhất**:
    ```sql
    BEGIN;
    INSERT INTO orders (id, status, total) VALUES ('ord-1', 'PENDING', 800);
    INSERT INTO outbox_events (id, aggregate_id, event_name, payload) VALUES ('evt-1', 'ord-1', 'OrderCreated', '...');
    COMMIT;
    ```
  - Nếu commit DB thành công $\rightarrow$ cả Order và Event đều tồn tại bền vững.
  - Nếu commit DB thất bại $\rightarrow$ cả hai đều tự động bị rollback sạch sẽ, không có bất kỳ Ghost Event nào thoát ra ngoài mạng.

---

## 2. Thử thách độc lập: Vẽ Event Lifecycle khi fail DB commit

### Sơ đồ vòng đời sự kiện khi gặp sự cố Rollback Database:

```
[Use Case: CreateOrder]             [PostgreSQL Database]             [Transactional Outbox Relay]       [Cloud Pub/Sub Broker]
          |                                   |                                     |                              |
          | 1. Order.create()                 |                                     |                              |
          |    -> Sinh OrderCreatedDomainEvent|                                     |                              |
          | 2. BEGIN TRANSACTION              |                                     |                              |
          |---------------------------------->|                                     |                              |
          | 3. INSERT INTO orders ...         |                                     |                              |
          |---------------------------------->|                                     |                              |
          | 4. INSERT INTO outbox_events ...  |                                     |                              |
          |---------------------------------->|                                     |                              |
          |                                   |                                     |                              |
          | 5. COMMIT TRANSACTION             |                                     |                              |
          |---------------------------------->|                                     |                              |
          |    X SỰ CỐ: Connection Reset /     |                                     |                              |
          |    Lock Timeout -> ROLLBACK!      |                                     |                              |
          |    (Cả 2 bảng đều được hoàn nguyên)|                                    |                              |
          |<----------------------------------|                                     |                              |
          |                                   |                                     |                              |
          | 6. Nhận lỗi Rollback              |                                     |                              |
          |    HỦY BỎ/DROP Domain Event trong |                                     |                              |
          |    bộ nhớ RAM; KHÔNG gửi gì đi!   |                                     |                              |
          |                                   | 7. Quét bảng outbox:                |                              |
          |                                   |    0 bản ghi sự kiện                |                              |
          |                                   |<------------------------------------|                              |
          |                                   |    -> Relay KHÔNG BẮN MESSAGE NÀO!  |                              |
          |                                   |                                     |------------------X           |
          |                                   |                                     |                              |
          v                                   v                                     v                              v
   (Khách nhận lỗi 500)                 (DB sạch sẽ)                   (Không có Ghost Event)         (Inventory/Payment nguyên vẹn)
```

### Phép thử chứng minh (Verification Test):
- Đoạn mã assertion độc lập chứng minh rằng khi commit thất bại thì Event Outbox bị xóa bỏ và Message Broker không nhận được message nào:
  ```javascript
  import assert from 'node:assert/strict';

  // Giả lập hệ thống Unit of Work với Transactional Outbox
  class MockDatabase {
    constructor() {
      this.orders = new Map();
      this.outbox = [];
      this.inTransaction = false;
      this.stagedOrders = new Map();
      this.stagedOutbox = [];
    }

    beginTransaction() {
      this.inTransaction = true;
      this.stagedOrders.clear();
      this.stagedOutbox = [];
    }

    insertOrder(id, data) {
      if (!this.inTransaction) throw new Error('NO_TRANSACTION');
      this.stagedOrders.set(id, data);
    }

    insertOutbox(event) {
      if (!this.inTransaction) throw new Error('NO_TRANSACTION');
      this.stagedOutbox.push(event);
    }

    commit(forceFail = false) {
      if (forceFail) {
        this.rollback();
        throw new Error('DATABASE_TRANSACTION_FAILED');
      }
      for (const [id, data] of this.stagedOrders) this.orders.set(id, data);
      this.outbox.push(...this.stagedOutbox);
      this.inTransaction = false;
    }

    rollback() {
      this.stagedOrders.clear();
      this.stagedOutbox = [];
      this.inTransaction = false;
    }
  }

  // Khởi tạo DB và Broker
  const db = new MockDatabase();
  const publishedToBroker = [];

  // Mô phỏng hàm xử lý tạo đơn an toàn qua Outbox
  function createOrderWithOutbox(orderId, failCommit = false) {
    db.beginTransaction();
    try {
      db.insertOrder(orderId, { status: 'PENDING' });
      db.insertOutbox({ eventName: 'OrderCreated', orderId });
      db.commit(failCommit);
    } catch (err) {
      db.rollback();
      throw err;
    }

    // Worker quét outbox (chỉ quét những gì ĐÃ commit)
    while (db.outbox.length > 0) {
      const evt = db.outbox.shift();
      publishedToBroker.push(evt);
    }
  }

  // 1. Phép thử khi Commit Thất Bại (Database Error)
  assert.throws(
    () => createOrderWithOutbox('ord-failed', true),
    /DATABASE_TRANSACTION_FAILED/
  );

  // CHỨNG MINH INVARIANT:
  // - Cơ sở dữ liệu sạch, không có đơn hàng rác
  assert.equal(db.orders.has('ord-failed'), false, 'Đơn hàng không được phép lưu vào DB');
  // - Bảng outbox trống, không còn event nào
  assert.equal(db.outbox.length, 0, 'Outbox không được chứa event khi rollback');
  // - Broker hoàn toàn không nhận được tin nhắn ma nào!
  assert.equal(publishedToBroker.length, 0, 'Tuyệt đối KHÔNG có Ghost Event gửi sang Pub/Sub!');

  // 2. Phép thử khi Commit Thành Công
  createOrderWithOutbox('ord-success', false);
  assert.equal(db.orders.has('ord-success'), true);
  assert.equal(publishedToBroker.length, 1, 'Event chỉ được phát tán khi commit DB thành công');
  console.log('PASS: Kiểm chứng Event Lifecycle khi fail DB commit thành công!');
  ```
