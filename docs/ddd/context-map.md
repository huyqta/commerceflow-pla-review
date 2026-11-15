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
