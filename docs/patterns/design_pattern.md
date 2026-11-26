# Tổng Hợp Code & Software Design Patterns Trong Dự Án CommerceFlow

Tài liệu này hệ thống hóa các **Code Design Patterns**, **Mô hình Hướng Miền (DDD)** và **Kiến trúc Sạch (Clean Architecture)** được áp dụng trong mã nguồn dự án **CommerceFlow**, đóng vai trò là tài liệu đào tạo chi tiết cho lập trình viên ở mọi cấp độ.

---

## Mục Lục
1. [Domain-Driven Design (DDD) Tactile Patterns](#1-domain-driven-design-ddd-tactile-patterns)
2. [Ports and Adapters / Hexagonal Architecture](#2-ports-and-adapters--hexagonal-architecture)
3. [CQRS (Command Query Responsibility Segregation)](#3-cqrs-command-query-responsibility-segregation)
4. [Unit of Work Pattern](#4-unit-of-work-pattern)
5. [Static Factory Method & Reconstitution Pattern](#5-static-factory-method--reconstitution-pattern)
6. [State Pattern & Invariant State Transition Machine](#6-state-pattern--invariant-state-transition-machine)
7. [Atomic Conditional Update & Optimistic Concurrency Control (Anti-Overselling)](#7-atomic-conditional-update--optimistic-concurrency-control-anti-overselling)
8. [Publish/Subscribe Pattern (In-Process & Distributed)](#8-publishsubscribe-pattern-in-process--distributed)

---

## 1. Domain-Driven Design (DDD) Tactile Patterns

### Vị trí triển khai
- [apps/order-service/src/domain/order.aggregate.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/domain/order.aggregate.ts)
- [docs/adr/ADR-002.md](file:///Users/huy/projects-h/commerceflow-pla-review/docs/adr/ADR-002.md)

### Như thế nào (Cách thức hiện thực)
Tầng Domain được thiết kế hoàn toàn thuần TypeScript (POJO), không phụ thuộc vào bất kỳ framework web (NestJS/Express) hay ORM (Prisma/TypeORM) nào:
- **Aggregate Root (`Order`):** Đóng vai trò là cổng truy cập duy nhất vào cụm thực thể đơn hàng. Mọi thay đổi dữ liệu hoặc trạng thái bên trong đều phải thông qua các phương thức của `Order`.
- **Entities (`OrderLineItem`):** Thực thể có định danh (`productId`), chứa số lượng và đơn giá, nhưng chỉ tồn tại trong ngữ cảnh của `Order`.
- **Value Objects (`Quantity`, `Money`):**
  - Đối tượng không có danh tính, được định danh bằng giá trị của nó.
  - Mang tính **bất biến hoàn toàn (Deep Immutability)**: Không có hàm setter.
  - Tự bảo vệ tính hợp lệ (Self-Validation): `Quantity` ném lỗi nếu $\le 0$ hoặc không phải số nguyên; `Money` ném lỗi nếu số tiền $< 0$.
- **Domain Events (`OrderCreatedDomainEvent`, `OrderConfirmedDomainEvent`):**
  - Ghi nhận những sự kiện nghiệp vụ quan trọng đã diễn ra trong quá khứ.
  - Được lưu trữ tạm thời trong mảng `domainEvents` của Aggregate Root và chỉ được phát tán ra ngoài khi lưu DB thành công.

### Vấn đề giải quyết
- Ngăn ngừa tình trạng **Anemic Domain Model** (Model chỉ chứa getter/setter rỗng tuếch, toàn bộ logic nghiệp vụ bị phân mảnh nằm rải rác ở tầng Service hoặc Controller).
- Tập trung hóa toàn bộ quy tắc nghiệp vụ (Business Rules) vào một nơi duy nhất.

### Ưu nhược điểm & Lưu ý
- **Ưu điểm:** Khả năng kiểm thử (Unit Test) cực cao, chạy siêu nhanh mà không cần khởi động database hay mock framework phức tạp.
- **Lưu ý:** Đòi hỏi lập trình viên phải hiểu rõ ranh giới Aggregate; không để các Aggregate gọi trực tiếp repository của nhau.

---

## 2. Ports and Adapters / Hexagonal Architecture

### Vị trí triển khai
- **Port:** [apps/order-service/src/application/ports/order-repository.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/application/ports/order-repository.ts#L14-L40)
- **Adapters:**
  - In-Memory Adapter: [InMemoryOrderRepository](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/application/ports/order-repository.ts#L47-L57)
  - PostgreSQL Adapter: [apps/order-service/src/infrastructure/postgres-order.repository.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/infrastructure/postgres-order.repository.ts)
  - Catalog Adapter: [apps/catalog-service/src/catalog.controller.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/catalog-service/src/catalog.controller.ts)

### Như thế nào (Cách thức hiện thực)
- Áp dụng nguyên lý **Đảo ngược phụ thuộc (Dependency Inversion Principle - DIP)**:
  - Tầng **Application/Domain** sở hữu `Port` (Giao diện trừu tượng `interface OrderRepository`).
  - Tầng **Infrastructure** đứng ngoài và phụ thuộc vào Port bằng cách triển khai (implements) giao diện đó (`class PostgresOrderRepository implements OrderRepository`).
- Tầng Domain tuyệt đối không import tầng Infrastructure.

### Vấn đề giải quyết
- Tách rời mã nguồn nghiệp vụ cốt lõi khỏi các chi tiết công nghệ bên ngoài (database, bên thứ ba, giao diện người dùng).
- Cho phép hoán đổi công nghệ lưu trữ (từ In-Memory sang PostgreSQL, hoặc MongoDB) mà không cần chỉnh sửa một dòng code nghiệp vụ nào trong Domain hay Use Case.

### Ưu nhược điểm & Lưu ý
- **Ưu điểm:** Cực kỳ linh hoạt khi viết test: Unit Test dùng `InMemoryOrderRepository` để chạy trong vài mili-giây, Integration Test dùng `PostgresOrderRepository` để xác thực truy vấn SQL thực tế.
- **Lưu ý:** Cần viết hàm ánh xạ (Mapper) để chuyển đổi giữa mô hình lưu trữ (Database Row / DTO) và mô hình nghiệp vụ (Domain Aggregate Root).

---

## 3. CQRS (Command Query Responsibility Segregation)

### Vị trí triển khai
- [apps/order-service/src/application/use-cases/create-order.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/application/use-cases/create-order.ts)

### Như thế nào (Cách thức hiện thực)
Tách biệt hoàn toàn hai luồng xử lý:
1. **Command Side (Ghi/Thay đổi trạng thái):**
   - Định nghĩa `CreateOrderCommand` và `CreateOrderUseCase`.
   - Thực thi các quy tắc kiểm tra logic khắt khe thông qua Aggregate Root, lưu dữ liệu vào database, phát sinh Domain Events.
   - Chỉ trả về thông tin kết quả cơ bản (`CreateOrderResult`: `orderId`, `status`, `totalAmount`).
2. **Query Side (Đọc dữ liệu):**
   - Định nghĩa `GetOrderByIdQuery` và `GetOrderByIdQueryHandler`.
   - Bỏ qua các bước kiểm tra nghiệp vụ phức tạp của Aggregate, truy vấn nhanh và trả về đối tượng hiển thị `OrderViewDto` tối ưu riêng cho giao diện người dùng. Không gây bất kỳ tác dụng phụ (no side-effects) nào lên hệ thống.

### Vấn đề giải quyết
- Giải quyết sự xung đột cố hữu giữa mô hình đọc và mô hình ghi: Mô hình ghi cần chuẩn hóa và kiểm tra invariants chặt chẽ; mô hình đọc cần tối ưu về tốc độ truy vấn và độ phẳng của dữ liệu hiển thị.

### Ưu nhược điểm & Lưu ý
- **Ưu điểm:** Giữ mã nguồn sáng sủa, tách biệt rõ ràng mục đích của từng hàm; dễ mở rộng sau này (ví dụ: tạo bảng Read-Replica hoặc Elasticsearch riêng cho Query).
- **Lưu ý:** Tăng số lượng file và class trong tầng Application.

---

## 4. Unit of Work Pattern

### Vị trí triển khai
- [apps/order-service/src/application/use-cases/create-order.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/application/use-cases/create-order.ts#L104-L160)

### Như thế nào (Cách thức hiện thực)
- Định nghĩa giao diện `UnitOfWork` với các phương thức: `startTransaction()`, `commit()`, `rollback()` và hàm thực thi bao bọc `execute<T>(work: () => Promise<T>): Promise<T>`.
- Trong `CreateOrderUseCase`, toàn bộ khối công việc tạo đơn và lưu kho lưu trữ được bọc trong `unitOfWork.execute(...)`.
- Nếu có bất kỳ lỗi nào xảy ra trong khối lệnh, hàm tự động gọi `rollback()` và ném lỗi ra ngoài.

### Vấn đề giải quyết
- Quản lý **Ranh giới giao dịch (Transaction Boundary)** tập trung tại tầng Use Case.
- Ngăn ngừa lỗi nguy hiểm: Bọc các cuộc gọi API bên ngoài (HTTP request, gửi mail) vào bên trong một SQL transaction đang giữ khóa (lock) dữ liệu, gây nghẽn pool kết nối của cơ sở dữ liệu.

### Ưu nhược điểm & Lưu ý
- **Ưu điểm:** Đảm bảo nguyên tắc "All or Nothing" (thành công toàn bộ hoặc không có gì thay đổi) của một nghiệp vụ.
- **Lưu ý:** Transaction chỉ nên kéo dài tối đa vài mili-giây trên database; các tác vụ I/O mạng bên ngoài phải được đẩy ra ngoài transaction thông qua Outbox Pattern.

---

## 5. Static Factory Method & Reconstitution Pattern

### Vị trí triển khai
- [apps/order-service/src/domain/order.aggregate.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/domain/order.aggregate.ts#L147-L245)

### Như thế nào (Cách thức hiện thực)
- Hàm khởi tạo chính (`constructor`) của lớp `Order` được để ở phạm vi `private`. Người ngoài không thể gọi `new Order(...)` tùy tiện.
- Cung cấp hai phương thức tĩnh (Static Factory Methods) với mục đích rõ rệt:
  - `Order.create(...)`: Dành cho việc **tạo mới đơn hàng**. Phương thức này kiểm tra toàn bộ invariants, tạo các Value Object, thiết lập trạng thái khởi đầu là `PENDING` và **phát sinh sự kiện `OrderCreatedDomainEvent`**.
  - `Order.reconstitute(...)`: Dành cho tầng Persistence (Repository) **khôi phục lại thực thể từ cơ sở dữ liệu**. Phương thức này gán lại trạng thái lịch sử (`status`, `createdAt`, `updatedAt`) và **TUYỆT ĐỐI KHÔNG phát sinh lại sự kiện `OrderCreatedDomainEvent`**.

### Vấn đề giải quyết
- Đảm bảo một Aggregate Root chỉ có thể được sinh ra ở trạng thái hoàn toàn hợp lệ.
- Tránh lỗi nghiêm trọng: Phát sinh lại các sự kiện miền trong quá khứ khi đọc bản ghi từ DB lên bộ nhớ (dẫn đến việc bắn lại email hoặc trừ kho lần 2).

---

## 6. State Pattern & Invariant State Transition Machine

### Vị trí triển khai
- [apps/order-service/src/domain/order.aggregate.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/domain/order.aggregate.ts#L247-L325)
- [apps/order-service/src/application/order-saga.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/order-service/src/application/order-saga.ts#L19-L33)

### Như thế nào (Cách thức hiện thực)
- Trạng thái của đơn hàng tuân thủ một máy trạng thái hữu hạn nghiêm ngặt:
  - `PENDING` $\rightarrow$ `CONFIRMED`
  - `PENDING` $\rightarrow$ `CANCELLED`
  - `PENDING` $\rightarrow$ `REJECTED`
- Các phương thức chuyển trạng thái (`confirm()`, `cancel()`, `reject()`) tự kiểm tra tiền điều kiện:
  - Ví dụ: Trong `confirm()`, nếu trạng thái hiện tại là `CANCELLED` hoặc `REJECTED`, phương thức sẽ lập tức ném ngoại lệ `INVALID_TRANSITION: CANNOT_CONFIRM_CANCELLED_ORDER`.
  - Không cho phép hủy một đơn hàng đã chuyển sang `CONFIRMED`.

### Vấn đề giải quyết
- Ngăn chặn lỗi vi phạm logic kinh doanh do các request bất đồng bộ gửi tới sai thứ tự (ví dụ: lệnh hủy đơn đến trước, sau đó lệnh xác nhận thanh toán lại đến sau).

---

## 7. Atomic Conditional Update & Optimistic Concurrency Control (Anti-Overselling)

### Vị trí triển khai
- [apps/inventory-service/src/infrastructure/postgres-inventory.repository.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/inventory-service/src/infrastructure/postgres-inventory.repository.ts#L44-L64)
- [apps/inventory-service/src/application/reserve-stock.ts](file:///Users/huy/projects-h/commerceflow-pla-review/apps/inventory-service/src/application/reserve-stock.ts)
- [labs/CF-014/reservation-race.mjs](file:///Users/huy/projects-h/commerceflow-pla-review/labs/CF-014/reservation-race.mjs)

### Như thế nào (Cách thức hiện thực)
- Thay vì đọc số lượng tồn lên bộ nhớ rồi trừ (`read-modify-write`), câu lệnh SQL cập nhật tồn kho sử dụng mệnh đề điều kiện nguyên tử:
  ```sql
  UPDATE inventory_stocks
  SET available_stock = available_stock - $1,
      reserved_stock = reserved_stock + $1,
      version = version + 1
  WHERE product_id = $2 AND available_stock >= $1;
  ```
- Kết hợp với ràng buộc toàn vẹn cơ sở dữ liệu `CHECK (available_stock >= 0)`.
- Nếu số lượng dòng bị ảnh hưởng (`rowCount`) bằng 0, hệ thống biết ngay sản phẩm đã hết hàng và từ chối giao dịch an toàn.

### Vấn đề giải quyết
- Triệt tiêu hoàn toàn lỗi **Bán vượt tồn kho (Overselling / Race Condition)** khi có hàng trăm yêu cầu đặt hàng cùng lúc mà không cần sử dụng khóa bi quan (`SELECT ... FOR UPDATE`) gây khóa cứng bảng dữ liệu.

### Ưu nhược điểm & Lưu ý
- **Ưu điểm:** Hiệu năng cực cao, không bao giờ xảy ra Database Deadlock.
- **Lưu ý:** Phía client cần nhận biết lỗi để thông báo kịp thời cho người dùng khi sản phẩm đã hết hàng.

---

## 8. Publish/Subscribe Pattern (In-Process & Distributed)

### Vị trí triển khai
- [packages/messaging/src/event-bus.ts](file:///Users/huy/projects-h/commerceflow-pla-review/packages/messaging/src/event-bus.ts)

### Như thế nào (Cách thức hiện thực)
- Cung cấp giao diện trừu tượng `IEventBus` với các phương thức chuẩn:
  - `publish<T>(topic: string, event: VersionedIntegrationEvent<T>): Promise<void>`
  - `subscribe<T>(topic: string, handler: EventHandler<T>): Promise<Subscription>`
- Lớp `InMemoryEventBus` hỗ trợ mô hình hóa hàng đợi ngay trong tiến trình, hỗ trợ cơ chế phát tán sự kiện đến nhiều người nhận (Fan-out) phục vụ unit tests và phát triển cục bộ.
- Có khả năng cắm adapter Cloud Pub/Sub thực tế mà không phải thay đổi mã nguồn các service đăng ký sự kiện.

### Vấn đề giải quyết
- Giảm thiểu sự gắn kết (Decoupling) giữa các thành phần sản xuất sự kiện (Producer) và các thành phần tiêu thụ sự kiện (Consumers).
