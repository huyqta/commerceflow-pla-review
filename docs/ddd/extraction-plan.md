# Kế hoạch Bóc Tách Dịch Vụ, Ranh Giới Service & Quyền Sở Hữu Dữ Liệu (Extraction Plan)

**Dự án:** CommerceFlow Cloud-Native Platform  
**Phiên bản:** 1.0.0  
**Tài liệu tham chiếu:** [docs/requirements.md](../requirements.md), [docs/ddd/context-map.md](context-map.md), [docs/architecture.md](../architecture.md)

---

## 1. Giới thiệu & Mục tiêu Kiến trúc

Tài liệu này xác định chiến lược chuyển đổi hệ thống **CommerceFlow** từ kiến trúc **Modular Monolith** (Milestone M3) sang kiến trúc phân tán **Microservices** (Milestone M4).

### Mục tiêu cốt lõi:
1. **Service Boundaries (Ranh giới dịch vụ):** Phân định ranh giới theo Bounded Contexts của Domain-Driven Design (DDD), phản ánh năng lực nghiệp vụ (Business Capabilities) thay vì phân chia máy móc theo kỹ thuật (CRUD/Table-driven).
2. **Data Ownership (Quyền sở hữu dữ liệu):** Tuân thủ tuyệt đối nguyên tắc **Database-per-service**. Một dịch vụ là chủ sở hữu duy nhất (Sole Owner) của cơ sở dữ liệu của nó; nghiêm cấm mọi truy vấn SQL liên dịch vụ (Cross-database query / Joint table / Foreign Key).
3. **Extraction Strategy (Chiến lược bóc tách):** Áp dụng mẫu kiến trúc **Strangler Fig Pattern** và **Event-Driven Architecture (EDA)** để trích xuất từng dịch vụ độc lập lên Google Cloud Run, đảm bảo Zero-Downtime và có Rollback Plan rõ ràng.
4. **Data Dependency Integrity (Tính toàn vẹn phụ thuộc):** Ma trận phụ thuộc dữ liệu giữa các dịch vụ phải là một Đồ thị có hướng phi chu trình (**DAG - Directed Acyclic Graph**), loại trừ triệt để phụ thuộc vòng tròn (Circular Dependency).

---

## 2. Phân định Ranh giới Bounded Contexts & API Contracts

Hệ thống được chia thành 4 microservices nghiệp vụ độc lập và 1 API Gateway chịu trách nhiệm định tuyến, xác thực:

```
+--------------------------------------------------------------------------------------------------+
|                                        API GATEWAY (BFF)                                         |
|                 (JWT AuthN, RBAC AuthZ, Routing, Rate Limiting, Request Validation)             |
+--------------------------------------------------------------------------------------------------+
          |                                  |                                     |
    (HTTP /sync)                       (HTTP /sync)                          (HTTP /sync)
          |                                  |                                     |
          v                                  v                                     v
+--------------------+             +--------------------+                +--------------------+
|   Catalog Service  |             |  Ordering Service  |                | Inventory Service  |
|   (Read-intensive) |             | (Saga Orchestrator)|                | (High-concurrency) |
+--------------------+             +--------------------+                +--------------------+
          |                                  |                                     |
          | (Catalog DB)                     | (Ordering DB)                       | (Inventory DB)
          v                                  v                                     v
+--------------------+             +--------------------+                +--------------------+
| PostgreSQL Schema  |             | PostgreSQL Schema  |                | PostgreSQL Schema  |
| - products         |             | - orders           |                | - inventory_items  |
| - categories       |             | - order_items      |                | - reservations     |
|                    |             | - outbox_events    |                | - inbox_events     |
+--------------------+             +--------------------+                +--------------------+
                                             ^                                     ^
                                             |        GCP Cloud Pub/Sub            |
                                             +=====================================+
                                              (Async Integration Events / Outbox)
```

### 2.1. Catalog Service (Read-Intensive Context)
- **Năng lực nghiệp vụ:** Quản lý danh mục hàng hóa, tên sản phẩm, mô tả, đơn giá niêm yết và danh mục phân loại.
- **Data Owner:** Sở hữu độc quyền database `catalog_db`.
- **Entities & Tables:** `products`, `categories`.
- **Public API Contracts:**
  - `GET /api/v1/products`: Truy vấn danh sách sản phẩm (hỗ trợ phân trang, lọc).
  - `GET /api/v1/products/:id`: Lấy chi tiết thông tin sản phẩm và đơn giá niêm yết.
  - `POST /api/v1/products`: Thêm mới sản phẩm (Quyền `staff` / `admin`).
- **Events phát ra:** `ProductCreated`, `ProductPriceChanged`.
- **Invariant:** Tuyệt đối không lưu trữ hay quản trị số lượng tồn kho khả dụng (`stockQuantity`); tồn kho thuộc quyền sở hữu duy nhất của Inventory Service.

### 2.2. Inventory Service (Concurrency-Critical Context)
- **Năng lực nghiệp vụ:** Quản lý tồn kho thực tế, tồn kho khả dụng, khóa giữ chỗ tạm thời (Reservation) khi đặt hàng và giải phóng tồn kho (Compensation/Release) khi đơn thất bại.
- **Data Owner:** Sở hữu độc quyền database `inventory_db`.
- **Entities & Tables:** `inventory_items`, `stock_reservations`, `inbox_events`.
- **Public API Contracts:**
  - `POST /api/v1/inventory/reserve`: Giữ chỗ tồn kho nguyên tử (`productId`, `quantity`, `orderId`). Trả về `RESERVED` hoặc `INSUFFICIENT_STOCK`.
  - `POST /api/v1/inventory/release`: Hoàn lại số lượng đã giữ khi thanh toán lỗi (Saga Compensation).
  - `GET /api/v1/inventory/:productId`: Tra cứu tồn kho khả dụng.
- **Events phát ra:** `InventoryReserved`, `InventoryReservationFailed`, `InventoryReleased`.
- **Invariant:** Chống overselling tuyệt đối qua Atomic Conditional Update (`UPDATE inventory_items SET available = available - qty WHERE id = @id AND available >= qty`). Không được phép tạo lệnh thanh toán hay can thiệp bảng `orders`.

### 2.3. Ordering Service (Workflow Orchestration Context)
- **Năng lực nghiệp vụ:** Tiếp nhận đơn hàng, quản lý vòng đời trạng thái đơn (`PENDING`, `CONFIRMED`, `CANCELLED`, `REJECTED`), điều phối Saga Orchestration qua Transactional Outbox Pattern.
- **Data Owner:** Sở hữu độc quyền database `order_db`.
- **Entities & Tables:** `orders`, `order_items`, `outbox_events`, `saga_instances`.
- **Public API Contracts:**
  - `POST /api/v1/orders`: Đặt hàng mới (Payload: `items`, `idempotencyKey`).
  - `GET /api/v1/orders/:id`: Tra cứu trạng thái đơn hàng và chi tiết các mục hàng.
- **Events phát ra:** `OrderCreated`, `OrderConfirmed`, `OrderCancelled`, `OrderRejected`.
- **Invariant:** State Machine không cho phép hủy đơn đã `CONFIRMED`. Không truy vấn trực tiếp bảng `products` hay `inventory_items` bằng SQL.

### 2.4. Payment Service / Simulator (External Gateway Context)
- **Năng lực nghiệp vụ:** Xử lý giao dịch thanh toán qua cổng thanh toán mô phỏng (hỗ trợ giả lập thành công, thất bại, timeout để kiểm thử Saga Compensation).
- **Data Owner:** Sở hữu độc quyền database `payment_db`.
- **Entities & Tables:** `payment_transactions`, `inbox_events`.
- **Public API Contracts:**
  - `POST /api/v1/payments/charge`: Thực hiện trừ tiền với `orderId`, `amount`, `idempotencyKey`.
- **Events phát ra:** `PaymentSucceeded`, `PaymentFailed`.
- **Invariant:** Không cập nhật trực tiếp trạng thái `orders` trong database của Ordering Service; chỉ thông báo kết quả qua Event hoặc API Response.

---

## 3. Data Ownership & Ma trận Phụ thuộc (Data Dependency Matrix)

### 3.1. Nguyên tắc Data Ownership (Database-per-service)
1. **Không bảng dùng chung (Zero Shared Tables):** Mỗi microservice có một connection string riêng biệt, trỏ tới database/schema riêng.
2. **Không khóa ngoại liên dịch vụ (Zero Cross-Service Foreign Keys):** Thay vì tạo `FOREIGN KEY (product_id) REFERENCES products(id)` ở cấp cơ sở dữ liệu, `order_items` chỉ lưu trữ `product_id` dưới dạng UUID chuỗi vô hướng và sao chép đơn giá tại thời điểm đặt hàng (`priceAtPurchase`).
3. **Chống rò rỉ thực thể (Zero Entity Leaking):** Dữ liệu trao đổi qua API Gateway và Event Broker đều qua DTOs / Integration Events đã được định nghĩa schema chặt chẽ.

### 3.2. Bảng phân định Quyền sở hữu Dữ liệu
| Service | Bounded Context | Database Name | Owned Tables | Read Permissions | Write Permissions |
|---|---|---|---|---|---|
| **Catalog** | Product Catalog | `catalog_db` | `products`, `categories` | Độc quyền | Độc quyền Catalog |
| **Inventory** | Stock Management | `inventory_db` | `inventory_items`, `stock_reservations`, `inbox_events` | Độc quyền | Độc quyền Inventory |
| **Ordering** | Order Lifecycle & Saga | `order_db` | `orders`, `order_items`, `outbox_events` | Độc quyền | Độc quyền Ordering |
| **Payment** | Payment Transactions | `payment_db` | `payment_transactions`, `inbox_events` | Độc quyền | Độc quyền Payment |

### 3.3. Ma trận Phụ thuộc Dữ liệu (Chứng minh DAG - Directed Acyclic Graph)
Để chứng minh kiến trúc không tồn tại phụ thuộc vòng tròn (Circular Dependency), luồng phụ thuộc dữ liệu và nghiệp vụ giữa các Bounded Contexts được mô hình hóa như sau:

| Source \ Target | Catalog | Inventory | Ordering | Payment |
|---|:---:|:---:|:---:|:---:|
| **Catalog** | - | Không | Không | Không |
| **Inventory** | Tham chiếu (Product ID) | - | Không | Không |
| **Ordering** | Đọc Snapshot (API) | Đặt chỗ (Event/API) | - | Kích hoạt (Event/API) |
| **Payment** | Không | Không | Trả kết quả (Event) | - |

```
    [Catalog Service] (Độc lập, không phụ thuộc service nào)
           ^
           | (Tra cứu thông tin / ID)
    [Ordering Service] -------------> [Inventory Service] (Giữ tồn kho)
           |                                  ^
           | (Kích hoạt thanh toán)            | (Bồi hoàn kho khi lỗi)
           v                                  |
    [Payment Service] ------------------------+
```

**Chứng minh tính phi chu trình (DAG Proof):**
- Topological Sort Order: `Catalog -> Inventory -> Payment -> Ordering`.
- Ordering phụ thuộc Catalog (lấy giá sản phẩm) và Inventory (khóa tồn kho).
- Inventory hoàn toàn không gọi Ordering để đọc/ghi database.
- Payment hoàn toàn không phụ thuộc ngược lại vào Ordering Database; Payment chỉ phát event `PaymentSucceeded`/`PaymentFailed` qua message broker.
- **Kết luận:** Không tồn tại bất kỳ chu trình nào ($C = \emptyset$). Đồ thị phụ thuộc đạt chuẩn DAG.

---

## 4. Chiến lược Bóc tách (Strangler Fig Pattern & Extraction Sequence)

Quá trình tách microservices từ Modular Monolith được thực hiện theo 4 giai đoạn an toàn:

### Giai đoạn 1: Baseline Modular Monolith (Hiện tại - M3)
- Các module `CatalogModule`, `InventoryModule`, `OrderModule` nằm trong cùng một repository monorepo.
- Tách biệt logic ở mức Application & Domain Layers.
- Database PostgreSQL có thể chia thành các Logical Schemas riêng biệt (`catalog.*`, `inventory.*`, `ordering.*`).
- Toàn bộ integration test suite xác thực kịch bản R-01 đến R-06 phải vượt qua 100%.

### Giai đoạn 2: Tách Catalog Service ra Cloud Run độc lập
- **Lý do tách trước:** Catalog là dịch vụ có tải đọc cao (Read-heavy, 90% traffic), ít thay đổi, logic nghiệp vụ ít phụ thuộc (Leaf node trong đồ thị).
- **Các bước thực hiện:**
  1. Tạo cơ sở dữ liệu `catalog_db` độc lập trên Cloud SQL.
  2. Di chuyển dữ liệu sản phẩm và thiết lập CDC (Change Data Capture) hoặc sao chép dữ liệu.
  3. Deploy Catalog Service lên Cloud Run.
  4. Cập nhật API Gateway định tuyến `/api/v1/products` sang Cloud Run mới.
  5. Đánh giá độ trễ và tỷ lệ lỗi qua metrics; ngắt kết nối schema cũ trong Monolith.

### Giai đoạn 3: Tách Inventory Service ra Cloud Run độc lập
- **Lý do:** Inventory đòi hỏi tính nhất quán cao, chịu tải tranh chấp (concurrency contention) khi có đợt Flash Sale.
- **Các bước thực hiện:**
  1. Tạo `inventory_db` độc lập.
  2. Triển khai API `/api/v1/inventory/reserve` và `/release`.
  3. Áp dụng kỹ thuật Dual-Writing hoặc In-memory Reservation Sync trong giai đoạn canary.
  4. Chuyển đổi gọi in-process thành REST API / gRPC giữa OrderModule (trong Monolith) và Inventory Service (Cloud Run).
  5. Giám sát các kịch bản R-02 (Hết hàng) và R-07 (Multi-item atomic).

### Giai đoạn 4: Tách Ordering Service & Payment Simulator (Hoàn tất Microservices - M4)
- Ordering Service được triển khai độc lập kèm Transactional Outbox Worker.
- Tích hợp GCP Cloud Pub/Sub làm Message Broker cho các sự kiện liên dịch vụ:
  - `OrderCreated` -> Inventory Service lắng nghe để reserve (nếu dùng Choreography) hoặc Order Service gửi command trực tiếp (Orchestration).
  - `PaymentProcessed` -> Order Service cập nhật trạng thái đơn thành `CONFIRMED` hoặc `CANCELLED`.
- Toàn bộ 4 services chạy trên các container Cloud Run độc lập với auto-scaling riêng biệt.

---

## 5. Kế hoạch Hoàn nguyên & Rollback Plan (Zero-Downtime Resilience)

Khi bóc tách một dịch vụ phân tán (đặc biệt là Inventory Service), rủi ro lớn nhất là sai lệch dữ liệu tồn kho (Data Inconsistency) hoặc độ trễ mạng gây nghẽn đơn hàng.

### Quy trình Rollback khi tách Inventory Service:
1. **Phát hiện lỗi (Trigger Conditions):**
   - Tỷ lệ lỗi 5xx trên API `/api/v1/inventory/reserve` vượt ngưỡng 1% trong 3 phút.
   - P99 Latency vượt quá 800ms.
   - Phát hiện hiện tượng Overselling (tồn kho âm) do lỗi đồng bộ.
2. **Các bước khôi phục (Step-by-step Rollback):**
   - **Bước 1 (Traffic Switching):** API Gateway chuyển ngay lập tức 100% traffic điều hướng ngược trở lại Monolith in-process Inventory Module thông qua Feature Flag (`USE_STANDALONE_INVENTORY=false`).
   - **Bước 2 (Reconciliation Data Sync):** Chạy script đối soát (Data Reconciliation Script) so sánh các bản ghi trong `stock_reservations` của Standalone Service với `inventory_items` của Monolith để hoàn trả các khoản tồn kho đang bị treo (Pending Locks).
   - **Bước 3 (Canary Re-evaluation):** Phân tích root-cause trong môi trường staging với synthetic test load trước khi tiến hành migration lại.

---

## 6. Phân tích Quyết định Kiến trúc & Đánh giá Trade-off

### Quyết định: Shared Database vs. Database-per-service
| Tiêu chí | Shared Database (Monolith Anti-pattern) | Database-per-service (Lựa chọn của CommerceFlow) |
|---|---|---|
| **Ranh giới dữ liệu** | Kém; dịch vụ này có thể SELECT/UPDATE bảng của dịch vụ khác. | Rõ ràng; dữ liệu được đóng gói an toàn đằng sau API/Event contract. |
| **Coupling (Độ phụ thuộc)** | Rất cao; thay đổi cột database làm gãy hàng loạt services. | Thấp (Loose coupling); mỗi service độc lập nâng cấp schema. |
| **Tính toàn vẹn (ACID)** | Dễ đạt được qua Local Database Transaction. | Đòi hỏi Eventual Consistency và Saga Pattern (Orchestration/Outbox). |
| **Khả năng mở rộng (Scale)** | Bị giới hạn bởi giới hạn phần cứng của một database tập trung. | Mở rộng độc lập (Catalog có thể dùng Read Replicas; Inventory dùng High IOPS). |
| **Độ phức tạp vận hành** | Đơn giản ban đầu nhưng trở thành nợ kỹ thuật nghiêm trọng. | Yêu cầu hạ tầng CI/CD, migration độc lập và distributed tracing. |

**Kết luận kỹ thuật:** Việc lựa chọn **Database-per-service** là bắt buộc cho mục tiêu của CommerceFlow để đảm bảo khả năng độc lập triển khai (Independent Deployability) và khả năng chịu lỗi cô lập (Fault Isolation).

---

## 7. Ánh xạ Kịch bản Nghiệp vụ (BDD Scenarios)
- **R-01 (Đơn hàng thành công):** Ordering Service tạo `PENDING` đơn -> gọi Inventory Service `reserve` -> gọi Payment Service `charge` -> chuyển `CONFIRMED`.
- **R-02 (Hết hàng):** Inventory Service trả về `INSUFFICIENT_STOCK` -> Ordering Service chuyển `REJECTED`, không kích hoạt Payment.
- **R-03 (Thanh toán lỗi & Saga Bồi hoàn):** Payment Service trả về lỗi -> Ordering Service gửi `ReleaseInventory` tới Inventory Service -> chuyển đơn thành `CANCELLED`.
- **R-04 (Chống Duplicate Delivery):** Mọi endpoint và event consumer trong các services đều kiểm tra Idempotency Key (`idempotency_key` / `event_id`) trước khi thực hiện side effect.
