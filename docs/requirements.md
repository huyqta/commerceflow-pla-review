# Yêu cầu CommerceFlow

## Vai trò

- Nhân viên: quản lý catalog, tạo đơn và xem trạng thái.
- Quản trị: xem vận hành và nhật ký, được quản lý quyền.

## BDD (Behavior-Driven Development — phát triển dựa trên hành vi) scenarios

### R-01 Đơn hàng thành công

Given sản phẩm A có stock=5 và giá 100;
When nhân viên đặt 2;
Then đơn chuyển PENDING→CONFIRMED và tồn khả dụng giảm 2 sau reserve.

### R-02 Hết hàng

Given stock=1;
When đặt 2;
Then request bị từ chối, tồn kho không âm, không tạo payment.

### R-03 Thanh toán lỗi

Given đã reserve 2;
When payment simulator trả failed;
Then order CANCELLED, inventory release 2, không double compensation.

### R-04 Duplicate delivery

Given OrderCreated có eventId=e1;
When broker gửi hai lần;
Then consumer chỉ tạo một reservation/payment side effect.

### R-05 Frontend eventual consistency

Given request đã nhận, Saga còn PENDING;
When UI polling;
Then hiển thị trạng thái pending, không báo confirmed giả.

### R-06 Security

Given user viewer;
When gọi write endpoint;
Then 403.
Given request không có token; Then 401.

## Nonfunctional lab targets (mục tiêu học, chưa phải SLO được đo)

- Tất cả transitions idempotent; các invariant có unit tests và concurrent integration tests.
- 100% service-to-service auth tại cloud boundary; giả lập failure retry.
- Mỗi order request có correlationId để truy vết ít nhất 3 services.
- Ngân sách học dự kiến $50 USD/tháng; không phải hard cap cloud billing.

## Out of scope

Payment gateway thật, dữ liệu khách thật, full e-commerce shipping/tax/refund, high-availability production SLO.

---

[ANSWER]
# Phân tích Chi tiết Yêu cầu, Use Cases & Tiêu chí Quan sát (Acceptance Scenarios)

## 1. Đặc tả Chi tiết các Use Cases Cốt lõi

### Use Case UC-01: Đặt hàng thành công (Happy Path)
- **Tác nhân:** Nhân viên bán hàng / Khách hàng.
- **Tiền điều kiện:** Người dùng đã xác thực (có Bearer JWT), sản phẩm tồn tại và đủ số lượng khả dụng (`available_stock >= requested_quantity`).
- **Luồng chính:**
  1. Người dùng gửi request tạo đơn hàng kèm danh sách sản phẩm.
  2. Ordering Service sinh mã đơn, lưu đơn ở trạng thái `PENDING`, phát sinh `OrderCreatedDomainEvent`.
  3. Transactional Outbox phát tán `OrderPlacedIntegrationEvent` lên Cloud Pub/Sub.
  4. Inventory Service nhận sự kiện, thực hiện giữ hàng (reserve stock) nguyên tử: `available_stock = available_stock - quantity`.
  5. Payment Service mô phỏng thanh toán thành công, gửi sự kiện `PaymentCapturedIntegrationEvent`.
  6. Ordering Service chuyển trạng thái đơn hàng sang `CONFIRMED`.

### Use Case UC-02: Đặt hàng khi hết hàng (Out of Stock Path)
- **Tác nhân:** Người dùng / Hệ thống.
- **Tiền điều kiện:** Sản phẩm có `available_stock < requested_quantity`.
- **Luồng xử lý:**
  1. Yêu cầu giữ hàng bị từ chối tại Inventory Service.
  2. Bắn sự kiện `InventoryReservationFailedIntegrationEvent`.
  3. Ordering Service chuyển trạng thái đơn sang `REJECTED`.
  4. Không có bất kỳ giao dịch trừ tiền hay ủy quyền thanh toán nào được tạo; tồn kho không bị âm.

### Use Case UC-03: Xử lý thanh toán lỗi & Bồi hoàn Saga (Compensation Path)
- **Tác nhân:** Payment Simulator / Hệ thống.
- **Tiền điều kiện:** Hàng đã được giữ thành công (`RESERVED`), nhưng cổng thanh toán trả về lỗi (`FAILED`).
- **Luồng bồi hoàn (Saga Compensation):**
  1. Payment Service phát tán sự kiện `PaymentFailedIntegrationEvent`.
  2. Ordering Service nhận sự kiện, chuyển trạng thái đơn từ `PENDING` sang `CANCELLED`.
  3. Ordering Service phát sự kiện bồi hoàn `ReleaseInventoryCommand`.
  4. Inventory Service hoàn trả đúng số lượng đã giữ: `available_stock = available_stock + reserved_quantity`.
  5. Đảm bảo tính Idempotency: Không được thực hiện hoàn kho lần thứ hai (chống double compensation).

---

## 2. Kịch bản Thử thách Độc lập: Đơn hàng có 2 sản phẩm (Multi-item Atomic Reservation)

### ### R-07 Đơn hàng có 2 sản phẩm — Đặt thành công
- **Given (Tiền đề):** 
  - Sản phẩm A có `stock = 5` và giá 100.
  - Sản phẩm B có `stock = 10` và giá 200.
- **When (Hành động):** 
  - Khách hàng tạo một đơn hàng duy nhất gồm 2 sản phẩm: 2 sản phẩm A và 3 sản phẩm B.
- **Then (Kết quả mong đợi & Tiêu chí quan sát):**
  - Trạng thái đơn hàng chuyển `PENDING` $\rightarrow$ `CONFIRMED`.
  - Tồn kho khả dụng của sản phẩm A giảm 2 (còn 3).
  - Tồn kho khả dụng của sản phẩm B giảm 3 (còn 7).
  - Tổng tiền đơn hàng được tính toán chính xác: $2 \times 100 + 3 \times 200 = 800$.

### ### R-08 Đơn hàng có 2 sản phẩm — Một sản phẩm hết hàng (All-or-Nothing / Partial Failure)
- **Given (Tiền đề):**
  - Sản phẩm A có `stock = 5` (đủ hàng).
  - Sản phẩm B có `stock = 1` (chỉ còn 1).
- **When (Hành động):**
  - Khách hàng tạo đơn hàng gồm: 2 sản phẩm A và 2 sản phẩm B (sản phẩm B bị thiếu 1 sản phẩm).
- **Then (Kết quả mong đợi & Tiêu chí quan sát):**
  - Toàn bộ đơn hàng bị từ chối ngay lập tức (`REJECTED`) vì vi phạm tính toàn vẹn của giỏ hàng.
  - **Tính bất biến (Invariant):** Tồn kho của sản phẩm A **giữ nguyên 5**, tuyệt đối không bị giữ dở dang (no partial reservation). Tồn kho của sản phẩm B giữ nguyên 1.
  - Không phát sinh yêu cầu thanh toán nào sang Payment Service.

---

## 3. Bảng Ma trận Tiêu chí Quan sát (Observable Acceptance Criteria)

| Mã Scenario | Trạng thái Order (Database) | Trạng thái Inventory | Tác vụ Payment | Sự kiện Pub/Sub phát sinh | HTTP Response |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **R-01** (Đơn thành công) | `CONFIRMED` | `available_stock` giảm tương ứng | `CAPTURED` | `OrderPlaced`, `InventoryReserved`, `PaymentCaptured` | `201 Created` |
| **R-02** (Hết hàng) | `REJECTED` | Giữ nguyên, không âm | Không có | `InventoryReservationFailed`, `OrderRejected` | `400 Bad Request` hoặc `422` |
| **R-03** (Thanh toán lỗi) | `CANCELLED` | Hoàn trả nguyên trạng số lượng đã giữ | `FAILED` | `PaymentFailed`, `InventoryReleased` | `200 OK` (Async Status Polling) |
| **R-07** (2 sản phẩm - Đủ) | `CONFIRMED` | A giảm 2, B giảm 3 | `CAPTURED` (Tổng 800) | `OrderPlaced` (2 items), `InventoryReserved` | `201 Created` |
| **R-08** (2 sản phẩm - Thiếu) | `REJECTED` | A giữ nguyên 5, B giữ nguyên 1 | Không có | `InventoryReservationFailed`, `OrderRejected` | `422 Unprocessable` |

