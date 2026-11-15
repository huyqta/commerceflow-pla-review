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

