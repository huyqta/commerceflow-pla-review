# Bounded Context Map

| Context | Owns | Public contracts | Không được phép |
|---|---|---|---|
| Catalog | Product, price | Product API | ghi trực tiếp Order DB |
| Ordering | Order, Saga, Outbox | OrderCreated, OrderConfirmed, OrderCancelled | cập nhật stock SQL trực tiếp |
| Inventory | Stock, Reservation, Inbox | InventoryReserved/Failed, InventoryReleased | tạo Payment |
| Payments | Simulated Payment, Inbox | PaymentSucceeded/Failed | đổi trạng thái Order qua SQL |

## Event storming mẫu
PlaceOrder command → OrderCreated event → ReserveInventory → InventoryReserved → ChargePayment → PaymentSucceeded → ConfirmOrder.
PaymentFailed → ReleaseReservation (compensation) → OrderCancelled.

**Phải review:** Domain events trong cùng service không đồng nhất integration events qua broker.

---

[ANSWER]
# Phân tích Event Storming, Bounded Context Map & Luồng Quyền sở hữu (Ownership)

## 1. Mô hình Event Storming Chi Tiết trong CommerceFlow

Mô hình Event Storming chuẩn hóa theo 4 thành phần nghiệp vụ:
- **Command (Xanh):** Yêu cầu thực hiện hành vi.
- **Aggregate (Vàng):** Thực thể nghiệp vụ bảo vệ invariant.
- **Domain Event (Cam):** Kết quả sự việc đã hoàn thành.
- **Policy (Tím):** Quy tắc nghiệp vụ tự động (*Whenever [Event] Then [Command]*).

```
+--------------------------------------------------------------------------------------------------------------------------------+
|                                                   EVENT STORMING TIMELINE                                                      |
|                                                                                                                                |
| [Command: SubmitOrder] ---> (Aggregate: Order) ---> [Event: OrderCreated / OrderPlaced]                                        |
|                                                               |                                                                |
|                                                               v (Policy: Whenever OrderPlaced Then ReserveStock)               |
|                                                     [Command: ReserveInventory] ---> (Aggregate: InventoryItem)                |
|                                                                                             |                                  |
|                               +-------------------------------------------------------------+                                  |
|                               | (Thành công)                                                | (Thất bại: Hết hàng)             |
|                               v                                                             v                                  |
|                 [Event: InventoryReserved]                                    [Event: InventoryReservationFailed]              |
|                               |                                                             |                                  |
|                               v (Policy: Whenever Reserved Then Charge)                     v (Policy: Then RejectOrder)       |
|                 [Command: ProcessPayment] ---> (PaymentGateway)                       [Command: RejectOrder]                   |
|                               |                                                             |                                  |
|               +---------------+---------------+                                             v                                  |
|               | (Thành công)                  | (Thanh toán lỗi)                      [Event: OrderRejected]                   |
|               v                               v                                                                                |
|     [Event: PaymentCaptured]       [Event: PaymentFailed]                                                                      |
|               |                               |                                                                                |
|               v (Policy: Then Confirm)        v (Policy: Whenever PaymentFailed Then Compensate)                               |
|     [Command: ConfirmOrder]        [Command: ReleaseInventory] ---> (InventoryItem) ---> [Event: InventoryReleased]            |
|               |                               |                                                                                |
|               v                               v (Policy: Then CancelOrder)                                                     |
|     [Event: OrderConfirmed]        [Command: CancelOrder] ---> (Order) ---> [Event: OrderCancelled]                             |
+--------------------------------------------------------------------------------------------------------------------------------+
```

---

## 2. Bounded Context Map & Ma trận Quyền sở hữu (Ownership Matrix)

Phân định ranh giới giữa các Bounded Context để ngăn chặn việc rò rỉ mô hình dữ liệu (Database Schema Leakage):

| Bounded Context | Core Aggregates & Data Owned | Inbound Commands tiếp nhận | Outbound Events phát tán | Policies & Automation |
| :--- | :--- | :--- | :--- | :--- |
| **Catalog Context** | `Product`, `Category`, `Price` | `CreateProduct`, `UpdatePrice` | `ProductCreated`, `PriceChanged` | Cung cấp dữ liệu tham chiếu (Read-only) cho Ordering. |
| **Ordering Context** | `Order`, `OrderLineItem`, `OrderSagaState` | `SubmitOrder`, `ConfirmOrder`, `CancelOrder` | `OrderCreated`, `OrderConfirmed`, `OrderCancelled` | **Orchestrator Policy:** Theo dõi tiến trình Saga, kích hoạt bù trừ khi có lỗi. |
| **Inventory Context** | `StockItem`, `ReservationRecord` | `ReserveInventory`, `ReleaseInventory` | `InventoryReserved`, `InventoryReservationFailed`, `InventoryReleased` | **Reservation Policy:** Đảm bảo trừ kho nguyên tử All-or-Nothing, kiểm soát không oversell. |
| **Payments Context** | `PaymentTransaction`, `SimulatorConfig` | `ProcessPayment`, `RefundPayment` | `PaymentCaptured`, `PaymentFailed` | **Payment Policy:** Tích hợp simulator, retry có giới hạn, thông báo kết quả bất đồng bộ. |

### Ranh giới kiến trúc bất biến (Architectural Invariants):
1. **Không truy cập chéo Database (No Cross-DB Queries):** Ordering Service tuyệt đối không được thực hiện SQL `SELECT/UPDATE` trực tiếp vào bảng của `Inventory` hay `Payments`. Mọi tương tác phải qua API công khai hoặc sự kiện bất đồng bộ.
2. **Ngôn ngữ chung (Ubiquitous Language):** Khái niệm "Item" trong `Catalog` là thông tin tiếp thị hiển thị; trong `Ordering` là dòng hóa đơn có giá chốt (`OrderLineItem`); trong `Inventory` là mã quản lý kho và vị trí kệ (`SKU/StockUnit`).

---

## 3. Phân tích Luồng sinh ra của `InventoryReserved` (Thử thách Độc lập)

### A. Nơi phát sinh (Origin of Event)
- Sự kiện `InventoryReserved` được **sinh ra duy nhất tại Inventory Bounded Context**.
- Thực thể chịu trách nhiệm phát sinh là Aggregate Root **`StockItem`** (hoặc `InventoryItem`) sau khi hoàn tất kiểm tra invariant nội bộ.

### B. Luồng chi tiết từng bước (Step-by-Step Flow):
1. **Kích hoạt từ bên ngoài:** Ordering Service xuất bản `OrderPlacedIntegrationEvent` lên Cloud Pub/Sub.
2. **Tiếp nhận tại Inventory:** Worker/Consumer của Inventory Service nhận message và chuyển thành Command nội bộ `ReserveInventoryCommand(orderId, items)`.
3. **Thực thi nghiệp vụ trong Aggregate:**
   - Nạp `StockItem` của từng mặt hàng từ cơ sở dữ liệu riêng của Inventory.
   - Kiểm tra Business Invariant: `available_stock >= requested_quantity`.
   - Cập nhật trạng thái: `available_stock = available_stock - requested_quantity`, đồng thời tạo một bản ghi `Reservation(orderId, quantity, status='HELD')`.
4. **Phát sinh sự kiện (Event Generation):**
   - `StockItem` tạo ra Domain Event `InventoryReservedDomainEvent`.
   - Transactional Outbox pattern ghi sự kiện này vào bảng `outbox` trong cùng transaction DB với bước trừ kho.
5. **Xuất bản ra Broker (Integration Event):**
   - Outbox Relay đẩy sự kiện **`InventoryReserved`** lên Cloud Pub/Sub topic `inventory-events`.
   - Ordering Service (Saga Coordinator) và Payment Service lắng nghe sự kiện này để kích hoạt bước tiếp theo: *Whenever `InventoryReserved` Then `ProcessPayment`*.

