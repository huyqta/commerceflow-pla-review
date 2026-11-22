# Evidence CF-018 — Tách Catalog và Inventory thành dịch vụ độc lập

**Status:** `verified`  
**Milestone:** M4  
**Date:** 2026-11-22  
**Environment:**
- OS: Windows 11 (pwsh / PowerShell 7)
- Node.js: `v24.12.0`
- Revision Git SHA: `650a90e` (và các commit kế tiếp)

---

## 1. Mục tiêu và Bối cảnh Nghiệp vụ
Bóc tách hai dịch vụ **Catalog Service** và **Inventory Service** từ Modular Monolith thành các dịch vụ độc lập:
- Khởi chạy riêng process và cổng mạng (Default: Catalog `3001`, Inventory `3002`).
- Loại bỏ hoàn toàn truy cập chéo cơ sở dữ liệu (Cross-service DB Access), mỗi service sở hữu schema riêng (`catalog_db` và `inventory_db`).
- Khả năng chịu lỗi độc lập (Fault Isolation): Chứng minh Inventory Service vẫn phục vụ đặt chỗ (Reserve) và bồi hoàn (Release) bình thường ngay cả khi Catalog Service bị dừng hoặc sự cố mạng.

---

## 2. Artifacts Tạo Mới & Chỉnh Sửa
1. `apps/inventory-service/src/main.ts` — Server HTTP độc lập của Inventory Service (PORT 3002, `X-Data-Owner: inventory_db`, endpoints `/health`, `/api/v1/inventory/:productId`, `/reserve`, `/release`).
2. `apps/catalog-service/src/main.ts` — Server HTTP độc lập của Catalog Service (PORT 3001, `X-Data-Owner: catalog_db`, endpoints `/health`, `/api/v1/products`, `/products/:id`).
3. `labs/CF-018/demo.mjs` — Micro-lab kiểm tra assertions độc lập ports (3001, 3002, 3003, 3004), cấm cross-schema access và xác minh file tồn tại.
4. `tests/standalone/catalog-inventory-standalone.test.ts` — Bộ automated test suite với 9 tests xác thực hoạt động độc lập, Fault Isolation khi Catalog sập, và các negative boundary tests.

---

## 3. Lệnh Thực Thi & Kết Quả Xác Minh

### 3.1. Chạy Micro-lab CF-018
```powershell
node labs/CF-018/demo.mjs
```
**Output:**
```
[CF-018 Micro-Lab] Bắt đầu kiểm tra Tách Catalog và Inventory thành dịch vụ độc lập...
✔ Toàn bộ kiểm tra cấu hình độc lập và phân định ranh giới CF-018 đều HỢP LỆ.
MICRO_LAB_OK CF-018
```
**Exit Code:** `0`

### 3.2. Chạy Automated Tests cho Standalone Services
```powershell
node --test tests/standalone/catalog-inventory-standalone.test.ts
```
**Output:**
```
▶ 1. Khởi chạy Dịch vụ Độc lập (Independent Processes & Ports)
  ✔ Catalog Service phản hồi trên cổng riêng (3001) với Header X-Data-Owner = catalog_db (2.4987ms)
  ✔ Inventory Service phản hồi trên cổng riêng (3002) với Header X-Data-Owner = inventory_db (0.5556ms)
  ✔ Cổng của Catalog và Inventory phải hoàn toàn khác nhau (Zero Port Conflict) (0.1503ms)
✔ 1. Khởi chạy Dịch vụ Độc lập (Independent Processes & Ports) (4.081ms)
▶ 2. Khả năng Chịu lỗi & Độc lập Tác vụ (Fault Isolation & Thử thách độc lập: Tắt Catalog)
  ✔ Thử thách độc lập: Khi Catalog Service tắt hoàn toàn, Inventory Service vẫn hoạt động độc lập (Fault Isolation) (3.0711ms)
  ✔ Inventory Service bồi hoàn (Release) thành công khi Saga hủy đơn mà không phụ thuộc Catalog (1.9641ms)
✔ 2. Khả năng Chịu lỗi & Độc lập Tác vụ (Fault Isolation & Thử thách độc lập: Tắt Catalog) (5.2587ms)
▶ 3. Loại bỏ Cross-service Database Access & Negative Tests
  ✔ Negative Case: Inventory Service từ chối cho phép truy cập trực tiếp schema của Catalog (0.2223ms)
  ✔ Negative Case: Catalog Service từ chối cho phép truy cập trực tiếp schema của Inventory (0.1445ms)
  ✔ Negative Case: Inventory Service từ chối request reserve khi vượt quá tồn kho khả dụng (409 Conflict) (0.4507ms)
  ✔ Negative Case: Chống double release (Idempotent Release) khi gọi bồi hoàn lần thứ 2 (0.871ms)
✔ 3. Loại bỏ Cross-service Database Access & Negative Tests (1.9833ms)
ℹ tests 9
ℹ suites 3
ℹ pass 9
ℹ fail 0
```
**Exit Code:** `0`

### 3.3. Chạy Hồi quy Toàn bộ Dự Án
```powershell
node --test tests/database/order-schema.test.ts tests/api/catalog-api.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/integration/order-api.spec.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts
```
**Kết quả:** 73/73 tests pass 100% (Thời gian chạy: ~360ms).

---

## 4. Tình Huống Biên & Negative Test Cases

### Tình huống 1: Ngăn chặn Truy cập Chéo Cơ sở Dữ liệu (Cross-service DB Access Guard)
- **Kịch bản:** Module cấu hình kiểm tra cờ `allowDirectCatalogAccess` và `allowDirectInventoryAccess`.
- **Hành vi:** Luôn thiết lập là `false`. Mọi truy vấn giữa các dịch vụ chỉ được thực hiện qua HTTP REST API hoặc Message Broker, không có kết nối database chung.
- **Kết quả:** Pass các assertion `allowDirectCatalogAccess === false` và `allowDirectInventoryAccess === false`.

### Tình huống 2: Hết hàng & Chống Overselling trong môi trường Standalone
- **Kịch bản:** Request gửi tới endpoint `POST /api/v1/inventory/reserve` với số lượng vượt quá tồn kho hiện có (ví dụ: kho có 2, đặt 5).
- **Hành vi:** Service trả về mã trạng thái `409 Conflict`, error code `OUT_OF_STOCK`, và không trừ bất kỳ tồn kho nào.
- **Kết quả:** Pass assertion HTTP 409 và bảo toàn số lượng khả dụng.

### Tình huống 3: Chống Double Release (Idempotent Saga Compensation)
- **Kịch bản:** Saga orchestrator gặp timeout mạng và gửi lệnh bồi hoàn `POST /api/v1/inventory/release` 2 lần cho cùng một đơn hàng.
- **Hành vi:** Lần 1 hoàn trả tồn kho (`status: RELEASED`, `released: true`). Lần 2 phát hiện reservation đã hoàn trả (`status: ALREADY_RELEASED`, `released: false`), không cộng thêm tồn kho lần thứ 2.
- **Kết quả:** Tồn kho bảo toàn chính xác số lượng gốc.

---

## 5. Engineering Judgment & Phân tích Đánh đổi (Trade-off Analysis)

### Trade-off: Service truy cập trực tiếp schema của nhau vs. Tách biệt hoàn toàn (Database-per-service)
- **Truy cập trực tiếp schema (Anti-pattern):**
  - *Ưu điểm ban đầu:* Dễ dàng thực hiện SQL `JOIN` giữa bảng `products` và `inventory_items` để lấy thông tin sản phẩm kèm số lượng tồn kho trong 1 câu lệnh duy nhất.
  - *Cái giá phải trả (Nhược điểm nghiêm trọng):*
    - Ghép nối chặt chẽ (Tight Database Coupling): Thay đổi cấu trúc bảng của một service sẽ làm gãy mã nguồn của service khác mà không có cảnh báo.
    - Không thể triển khai độc lập (Cannot Deploy Independently): Cần đồng bộ hóa migration cho toàn bộ hệ thống.
    - Không thể scale độc lập: Bị thắt nút cổ chai (Bottleneck) ở tầng database chung.
- **Tách biệt hoàn toàn (Database-per-service - CommerceFlow Choice):**
  - Phân tách rõ ràng quyền sở hữu. Catalog có thể dùng Read Replicas tối ưu cho đọc, trong khi Inventory sử dụng bộ nhớ cache phân tán hoặc cơ chế Conditional Update với IOPS cao.
  - Phụ thuộc duy nhất vào API Contract rõ ràng.

---

## 6. Lời giải Thử thách Độc lập (Independent Challenge Solution)

> **Câu hỏi:** Tắt Catalog và đo tác động tới Inventory? Mô tả một ví dụ và một phép thử để chứng minh.

### 1. Phân tích Tác động:
- **Catalog Service bị tắt hoàn toàn (Down/Unavailable):**
  - Các thao tác xem danh mục sản phẩm (`GET /api/v1/products`) hoặc tạo sản phẩm mới sẽ bị gián đoạn.
  - **Tác động tới Inventory Service:** **HOÀN TOÀN BẰNG KHÔNG (ZERO IMPACT)**.
  - **Lý do:** Inventory Service chỉ quản lý số lượng tồn kho theo mã `productId` (dưới dạng scalar UUID) và bản ghi reservation. Inventory không thực hiện bất kỳ câu truy vấn nào tới Catalog DB hay gọi HTTP sang Catalog trong quá trình reserve hoặc release.
  - Do đó, quy trình giữ hàng (Reserve) và giải phóng hàng (Release/Compensation) của các đơn hàng đang xử lý vẫn diễn ra bình thường, đảm bảo tính cô lập lỗi (Fault Isolation).

### 2. Phép thử Thực tế Đã Chứng Minh (Verification Test):
- Trong test suite [`tests/standalone/catalog-inventory-standalone.test.ts`](file:///e:/10_WORKS/AI_SKILL/commerceflow-pla-v1.2-review/commerceflow-pla-review/tests/standalone/catalog-inventory-standalone.test.ts) (Suite 2: *Khả năng Chịu lỗi & Độc lập Tác vụ*):
  - Catalog Service hoàn toàn không được khởi chạy (không tồn tại tiến trình hay cổng lắng nghe).
  - Khởi tạo Inventory Service với sản phẩm `PROD-X` có tồn kho 10.
  - Gửi request `POST /api/v1/inventory/reserve` đặt 3 món $\to$ Thành công với mã `200 OK`, tồn kho giảm còn 7.
  - Gửi request `POST /api/v1/inventory/release` hoàn lại 3 món $\to$ Thành công với mã `200 OK`, tồn kho hồi phục về 10.
  - **Kết luận:** Đã chứng minh bằng thực nghiệm rằng Inventory Service hoàn toàn độc lập và không bị ảnh hưởng khi Catalog Service dừng hoạt động.
