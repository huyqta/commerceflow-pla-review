# Bảng thuật ngữ CommerceFlow

Mọi acronym phải được giải nghĩa ở lần đầu xuất hiện trong từng Issue; khi có nhiều nghĩa, nêu ngữ cảnh.

## DDD

**English:** Domain-Driven Design  
**Tiếng Việt:** Thiết kế hướng miền nghiệp vụ  
**Ví dụ:** Tách Ordering và Inventory theo trách nhiệm; không theo bảng.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## API

**English:** Application Programming Interface  
**Tiếng Việt:** Giao diện lập trình ứng dụng  
**Ví dụ:** POST /orders tạo đơn.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## REST

**English:** Representational State Transfer  
**Tiếng Việt:** Kiểu kiến trúc giao tiếp tài nguyên qua HTTP  
**Ví dụ:** GET /products lấy danh sách.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## HTTP

**English:** Hypertext Transfer Protocol  
**Tiếng Việt:** Giao thức truyền siêu văn bản  
**Ví dụ:** POST /orders nhận 201.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## CI

**English:** Continuous Integration  
**Tiếng Việt:** Tích hợp liên tục  
**Ví dụ:** Pull request chạy lint và tests.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## CD (Delivery)

**English:** Continuous Delivery  
**Tiếng Việt:** Phân phối liên tục  
**Ví dụ:** Build release luôn sẵn sàng triển khai sau phê duyệt.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## CD (Deployment)

**English:** Continuous Deployment  
**Tiếng Việt:** Triển khai liên tục  
**Ví dụ:** Bản thay đổi đạt gate tự triển khai, khác Delivery.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## GCP

**English:** Google Cloud Platform  
**Tiếng Việt:** Nền tảng đám mây Google  
**Ví dụ:** Triển khai service lên Cloud Run.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## GKE

**English:** Google Kubernetes Engine  
**Tiếng Việt:** Dịch vụ Kubernetes được quản lý  
**Ví dụ:** Thử Deployment trên cluster lab.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## IAM

**English:** Identity and Access Management  
**Tiếng Việt:** Quản lý danh tính và quyền truy cập  
**Ví dụ:** Service account chỉ được subscribe đúng topic.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## JWT

**English:** JSON Web Token  
**Tiếng Việt:** Token web dạng JSON có chữ ký  
**Ví dụ:** Xác minh issuer và audience.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## OIDC

**English:** OpenID Connect  
**Tiếng Việt:** Chuẩn xác thực danh tính dựa trên OAuth 2.0  
**Ví dụ:** GitHub Actions sử dụng identity federation.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## ORM

**English:** Object-Relational Mapping  
**Tiếng Việt:** Ánh xạ đối tượng quan hệ  
**Ví dụ:** Prisma ánh xạ Order thành bản ghi.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## DTO

**English:** Data Transfer Object  
**Tiếng Việt:** Đối tượng truyền dữ liệu  
**Ví dụ:** CreateOrderDto validate quantity.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## SQL

**English:** Structured Query Language  
**Tiếng Việt:** Ngôn ngữ truy vấn cấu trúc  
**Ví dụ:** SELECT stock FROM inventory.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## ACID

**English:** Atomicity, Consistency, Isolation, Durability  
**Tiếng Việt:** Nguyên tử, nhất quán, cô lập, bền vững  
**Ví dụ:** Outbox + Order state commit cùng transaction.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## SAGA

**English:** Saga pattern (không phải acronym chuẩn)  
**Tiếng Việt:** Mẫu phối hợp giao dịch phân tán  
**Ví dụ:** Thanh toán lỗi thì release hàng.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## E2E

**English:** End-to-End  
**Tiếng Việt:** Kiểm thử từ đầu đến cuối  
**Ví dụ:** Playwright qua browser→API→DB.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## IaC

**English:** Infrastructure as Code  
**Tiếng Việt:** Hạ tầng bằng mã  
**Ví dụ:** Terraform plan xem thay đổi.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## HPA

**English:** Horizontal Pod Autoscaler  
**Tiếng Việt:** Bộ tự động tăng/giảm số pod ngang  
**Ví dụ:** Scale pods khi CPU cao.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## SLO

**English:** Service Level Objective  
**Tiếng Việt:** Mục tiêu mức dịch vụ  
**Ví dụ:** 99% đơn cập nhật trong 10 giây lab.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## SLI

**English:** Service Level Indicator  
**Tiếng Việt:** Chỉ số mức dịch vụ  
**Ví dụ:** Tỷ lệ đơn hoàn thành đo được.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## VPC

**English:** Virtual Private Cloud  
**Tiếng Việt:** Mạng riêng ảo  
**Ví dụ:** Chặn service DB public.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## ADR

**English:** Architecture Decision Record  
**Tiếng Việt:** Biên bản quyết định kiến trúc  
**Ví dụ:** Ghi vì sao chọn Cloud Run.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## DLQ

**English:** Dead-Letter Queue  
**Tiếng Việt:** Hàng đợi lỗi cần xử lý riêng  
**Ví dụ:** Event vượt retry được đưa DLQ.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## TDD

**English:** Test-Driven Development  
**Tiếng Việt:** Phát triển hướng kiểm thử  
**Ví dụ:** Viết failing test cho overselling trước.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## BDD

**English:** Behavior-Driven Development  
**Tiếng Việt:** Phát triển hướng hành vi  
**Ví dụ:** Given/When/Then cho thanh toán lỗi.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## CQRS

**English:** Command Query Responsibility Segregation  
**Tiếng Việt:** Tách trách nhiệm ghi và đọc  
**Ví dụ:** CreateOrder command, GetOrder query.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## YAML

**English:** YAML Ain’t Markup Language  
**Tiếng Việt:** Định dạng cấu hình dễ đọc  
**Ví dụ:** workflow CI viết dưới .yml.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

## RBAC

**English:** Role-Based Access Control  
**Tiếng Việt:** Kiểm soát quyền dựa trên vai trò  
**Ví dụ:** viewer không được xóa sản phẩm.  
**Hiểu lầm phổ biến:** Tên gọi không thay thế acceptance test; phải diễn giải trường hợp dùng.

---

[ANSWER]
# Chuyên đề Nền tảng: DDD, Clean Architecture, Microservices & GCP trong CommerceFlow

## 1. Concept Map Kiến trúc Tổng thể

Mối quan hệ giữa các khái niệm kiến trúc cốt lõi trong hệ thống CommerceFlow:

```
+---------------------------------------------------------------------------------------+
|                                GOOGLE CLOUD PLATFORM (GCP)                            |
|                                                                                       |
|  [React Frontend] --(HTTPS / OIDC)--> [Cloud Run: API Gateway]                        |
|                                                |                                      |
|                 +------------------------------+-------------------------------+      |
|                 | (Authenticated Service-to-Service via IAM)                   |      |
|                 v                                                              v      |
|   +---------------------------+                                  +------------------+ |
|   |  Ordering Microservice    |                                  | Inventory Service| |
|   |  (Cloud Run + Cloud SQL)  |                                  | (Cloud Run + SQL)| |
|   |                           |                                  |                  | |
|   |  +---------------------+  |                                  |  +-------------+ | |
|   |  | CLEAN ARCHITECTURE  |  |                                  |  | CLEAN ARCH. | | |
|   |  |  +---------------+  |  |                                  |  +-------------+ | |
|   |  |  | DOMAIN LAYER  |  |  |                                  |                  | |
|   |  |  | - Order Root  |  |  |                                  |                  | |
|   |  |  | - LineItem    |  |  |                                  |                  | |
|   |  |  | - PricingServ |  |  |                                  |                  | |
|   |  |  +---------------+  |  |                                  |                  | |
|   |  |         ^           |  |                                  |                  | |
|   |  |  +---------------+  |  |                                  |                  | |
|   |  |  | APPLICATION   |  |  |                                  |                  | |
|   |  |  | - CreateOrder |  |  |                                  |                  | |
|   |  |  +---------------+  |  |                                  |                  | |
|   |  |         ^           |  |                                  |                  | |
|   |  |  +---------------+  |  |                                  |                  | |
|   |  |  | INFRASTRUCTURE|  |  |                                  |                  | |
|   |  |  | - Prisma Repo |  |  |                                  |                  | |
|   |  |  | - Outbox Pub  |  |  |                                  |                  | |
|   |  |  +---------------+  |  |                                  |                  | |
|   |  +---------------------+  |                                  |                  | |
|   +-------------+-------------+                                  +--------+---------+ |
|                 | (Publish OrderCreated)                                  ^           |
|                 v                                                         |           |
|         +-----------------------------------------------------------------+           |
|         |                     Cloud Pub/Sub (Event Bus)                   |           |
|         +-----------------------------------------------------------------+           |
+---------------------------------------------------------------------------------------+
```

---

## 2. Phân biệt Aggregate với Service trong Domain-Driven Design (DDD)

Để tránh thiết kế mô hình nghèo nàn (Anemic Domain Model) hoặc vi phạm ranh giới bao gói, CommerceFlow phân biệt rõ 3 khái niệm:

### A. Aggregate (và Aggregate Root)
- **Định nghĩa:** Là một cụm (cluster) các Entity và Value Object liên kết chặt chẽ với nhau, được đối xử như một đơn vị nguyên tử duy nhất khi thay đổi dữ liệu. Aggregate Root là điểm truy cập duy nhất vào cụm này từ bên ngoài.
- **Trách nhiệm cốt lõi:**
  - Bảo vệ **Business Invariants** (các quy tắc nghiệp vụ bất biến phải luôn đúng tại mọi thời điểm).
  - Ranh giới của Transaction: Một transaction tại một thời điểm chỉ được phép sửa đổi trạng thái của duy nhất một Aggregate Root.
- **Ví dụ trong CommerceFlow:**
  - `Order` (Aggregate Root) chứa danh sách các `OrderLineItem` (Entity con) và `Money` (Value Object).
  - *Invariant bảo vệ:* Không thể xác nhận đơn (`confirm()`) nếu đơn chưa ở trạng thái `RESERVED`; tổng giá trị đơn phải khớp với tổng giá từng dòng; số lượng mặt hàng đặt phải > 0.
  - Bên ngoài không được truy cập hay sửa trực tiếp `OrderLineItem`, mọi thao tác phải thông qua phương thức nghiệp vụ của `Order` (`order.addItem(...)`, `order.cancel(...)`).

### B. Domain Service
- **Định nghĩa:** Là một dịch vụ nghiệp vụ thuần túy (stateless) nằm trong tầng Domain, chỉ xuất hiện khi một logic nghiệp vụ quan trọng không thể gán tự nhiên cho một Entity hay Value Object nào, hoặc logic đó cần tương tác đồng thời giữa nhiều Aggregate mà không muốn phá vỡ tính bao gói.
- **Trách nhiệm cốt lõi:**
  - Chứa logic nghiệp vụ cốt lõi, hoàn toàn không phụ thuộc vào hạ tầng (không import DB, HTTP, Framework).
- **Ví dụ trong CommerceFlow:**
  - `OrderPricingDomainService`: Tính toán giá cuối cùng của đơn hàng khi có chính sách chiết khấu động phức tạp cần đối chiếu dữ liệu giữa hạn mức khách hàng và danh sách mặt hàng của đơn.

### C. Application Service (Use Case)
- **Định nghĩa:** Là lớp điều phối (orchestrator) nằm ở tầng Application, đóng vai trò cầu nối giữa thế giới bên ngoài (Controllers, Message Listeners) và tầng Domain.
- **Trách nhiệm cốt lõi:**
  - **Không chứa business rules**.
  - Nhận DTO từ controller/adapter, mở transaction, gọi Repository để nạp Aggregate lên bộ nhớ.
  - Ra lệnh cho Aggregate hoặc Domain Service thực thi nghiệp vụ.
  - Lưu Aggregate đã thay đổi xuống database qua Repository và phát sinh Event (hoặc ghi vào Outbox).
- **Ví dụ trong CommerceFlow:**
  - `CreateOrderUseCase`:
    1. Nhận `CreateOrderDto`.
    2. Gọi `orderRepo.nextIdentity()` để sinh mã.
    3. Tạo thực thể `Order.create(...)`.
    4. Lưu vào Database qua `orderRepo.save(order)`.
    5. Ghi Outbox message để phát tán `OrderPlacedIntegrationEvent`.

---

## 3. Clean Architecture & Trật tự Phụ thuộc (Dependency Inversion)

Hệ thống áp dụng nghiêm ngặt nguyên tắc **Dependency Rule**: Luồng phụ thuộc mã nguồn chỉ hướng từ ngoài vào trong:

1. **Domain Layer (Trong cùng):**
   - Chứa Entities, Value Objects, Domain Events, Domain Services, và Repository Interfaces (Ports).
   - *Nguyên tắc vàng:* Không có bất kỳ dependency nào vào thư viện bên ngoài (không NestJS, không Prisma, không Express, không GCP SDK).
2. **Application Layer:**
   - Chứa Use Cases, DTOs, Command/Query Handlers, Outbox Service Interfaces.
   - Chỉ phụ thuộc vào Domain Layer.
3. **Infrastructure & Presentation Adapters (Ngoài cùng):**
   - Controllers, REST endpoints, Prisma Repositories, Pub/Sub Publisher/Subscriber, Cloud SQL, Secret Manager.
   - Triển khai (implement) các Interfaces do Domain và Application định nghĩa.

---

## 4. Microservices & Tích hợp Google Cloud Platform (GCP)

- **Chia dịch vụ:** Chia theo Bounded Context: `Catalog`, `Ordering`, `Inventory`, `Payments`. Mỗi dịch vụ có database schema độc lập (Database-per-service).
- **Giao tiếp liên dịch vụ:**
  - Đồng bộ (Chỉ dùng khi bắt buộc): REST/gRPC qua Cloud Run private service URL có xác thực IAM Service Account OIDC token.
  - Bất đồng bộ (Mặc định cho nghiệp vụ): Cloud Pub/Sub thông qua mẫu thiết kế **Transactional Outbox** để đảm bảo không bị dual-write rớt message.
- **Bảo mật và Danh tính:**
  - Người dùng xác thực qua OIDC/JWT; phân quyền Role-Based Access Control (RBAC).
  - Service Account tuân thủ nguyên tắc quyền tối thiểu (Least Privilege); Secret Manager lưu giữ database credentials và signing keys an toàn.

---

## 5. Phân biệt Domain Event và Integration Event

- **Domain Event (Sự kiện Miền):**
  - **Phạm vi & Vòng đời:** Diễn ra và được tiêu thụ cục bộ bên trong một Bounded Context (in-process).
  - **Mục đích:** Đồng bộ trạng thái hoặc kích hoạt side-effects nội bộ (ví dụ: `OrderCreatedDomainEvent` kích hoạt ghi bản ghi Outbox trong cùng transaction database).
  - **Đặc trưng:** Chứa thông tin chi tiết của mô hình nghiệp vụ nội bộ, không lộ ra ngoài service.

- **Integration Event (Sự kiện Tích hợp):**
  - **Phạm vi & Vòng đời:** Được xuất bản ra bên ngoài service thông qua Message Broker (Google Cloud Pub/Sub) để các service khác cùng tiêu thụ.
  - **Mục đích:** Giao tiếp bất đồng bộ giữa các Microservices (ví dụ: `OrderPlacedIntegrationEvent` báo cho Inventory Service để reserve tồn kho).
  - **Đặc trưng:** Schema phiên bản hóa ổn định, mang payload tối giản, tránh phụ thuộc chặt (tight coupling) vào cấu trúc dữ liệu nội bộ.



