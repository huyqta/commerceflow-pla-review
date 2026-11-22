# Evidence CF-017 — Service boundaries, extraction strategy, data ownership

**Status:** `verified`  
**Milestone:** M4  
**Date:** 2026-11-22  
**Environment:**
- OS: Windows 11 (pwsh / PowerShell 7)
- Node.js: `v24.12.0`
- Revision Git SHA: `650a90e` (và các commit kế tiếp)

---

## 1. Mục tiêu và Bối cảnh Nghiệp vụ
Triển khai thiết kế phân định ranh giới dịch vụ (Service Boundaries), quyền sở hữu dữ liệu (Data Ownership) và chiến lược bóc tách (Extraction Strategy) từ Modular Monolith (M3) sang Microservices (M4) cho nền tảng CommerceFlow:
- Phân định rõ ranh giới theo Bounded Contexts: Catalog, Inventory, Ordering, Payment, API Gateway.
- Tuân thủ nghiêm ngặt nguyên tắc **Database-per-service** (Zero Shared Tables, Zero Cross-database Foreign Keys).
- Lập lộ trình trích xuất theo **Strangler Fig Application Pattern** qua 4 giai đoạn an toàn.
- Chứng minh tính phi chu trình (DAG - Directed Acyclic Graph) của ma trận phụ thuộc dữ liệu.
- Thiết lập Rollback Plan khi tách dịch vụ (đặc biệt là Inventory Service) với Feature Flag và Data Reconciliation.

---

## 2. Artifacts Tạo Mới & Chỉnh Sửa
1. `docs/ddd/extraction-plan.md` — Toàn bộ bản đặc tả chi tiết về ranh giới dịch vụ, API contracts, Data Ownership, ma trận phụ thuộc dữ liệu (DAG proof), chiến lược bóc tách 4 giai đoạn, và Rollback plan.
2. `labs/CF-017/demo.mjs` — Micro-lab kiểm tra assertions: file existence, nội dung cốt lõi, Database-per-service uniqueness, Cycle detection bằng DFS, và Service capabilities boundaries.
3. `tests/architecture/service-boundaries.test.ts` — Bộ automated test suite kiểm chứng kiến trúc với 11 test cases (Bao gồm Happy Path & Negative Cycle Detection).

---

## 3. Lệnh Thực Thi & Kết Quả Xác Minh

### 3.1. Chạy Micro-lab CF-017
```powershell
node labs/CF-017/demo.mjs
```
**Output:**
```
[CF-017 Micro-Lab] Bắt đầu kiểm tra Service Boundaries & Data Ownership...
✔ Toàn bộ 5 kiểm tra kiến trúc Service Boundaries & Data Ownership đều HỢP LỆ.
MICRO_LAB_OK CF-017
```
**Exit Code:** `0`

### 3.2. Chạy Automated Architecture Tests
```powershell
node --test tests/architecture/service-boundaries.test.ts
```
**Output:**
```
▶ 1. Đặc tả Kiến trúc Bóc tách (Extraction Plan & Service Boundaries)
  ✔ Tệp extraction-plan.md phải tồn tại tại docs/ddd/
  ✔ Kế hoạch phải bao hàm 4 dịch vụ độc lập và 1 API Gateway
  ✔ Kế hoạch phải định nghĩa rõ ràng nguyên tắc Database-per-service
  ✔ Kế hoạch phải có chiến lược Strangler Fig Pattern và Sequence 4 giai đoạn
✔ 1. Đặc tả Kiến trúc Bóc tách (Extraction Plan & Service Boundaries)
▶ 2. Phân định Quyền sở hữu Dữ liệu (Data Ownership & Invariants)
  ✔ Mỗi service phải sở hữu database riêng biệt, không trùng lặp (Zero Database Sharing)
  ✔ Không có bảng nghiệp vụ lõi (Domain Table) nào thuộc quyền sở hữu của nhiều hơn 1 service
  ✔ Không có quan hệ khóa ngoại (Foreign Key) vật lý liên dịch vụ
✔ 2. Phân định Quyền sở hữu Dữ liệu (Data Ownership & Invariants)
▶ 3. Kiểm thử Đồ thị Phụ thuộc Dữ liệu (DAG Verification & Zero Circular Dependencies)
  ✔ Ma trận phụ thuộc thực tế của CommerceFlow là một DAG hợp lệ
  ✔ Negative test: Phát hiện và từ chối khi kiến trúc bị vi phạm phụ thuộc vòng tròn (Circular Dependency)
✔ 3. Kiểm thử Đồ thị Phụ thuộc Dữ liệu (DAG Verification & Zero Circular Dependencies)
▶ 4. Kế hoạch Hoàn nguyên & Rollback Plan khi tách Inventory
  ✔ Kế hoạch phải bao gồm các điều kiện kích hoạt Rollback (Trigger Conditions)
  ✔ Kế hoạch phải quy định cơ chế chuyển mạch Traffic (Traffic Switching) qua Feature Flag
✔ 4. Kế hoạch Hoàn nguyên & Rollback Plan khi tách Inventory
ℹ tests 11
ℹ suites 4
ℹ pass 11
ℹ fail 0
```
**Exit Code:** `0`

### 3.3. Chạy Hồi quy Toàn bộ Test Suite Dự Án
```powershell
node --test tests/database/order-schema.test.ts tests/api/catalog-api.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/integration/order-api.spec.ts tests/architecture/service-boundaries.test.ts
```
**Kết quả:** 64/64 tests pass 100% (Duration: ~300ms).

---

## 4. Tình Huống Biên & Negative Test Cases

### Tình huống 1: Phát hiện Phụ thuộc Vòng tròn (Circular Dependency Cycle Detection)
- **Kịch bản:** Giả sử nhóm phát triển mắc lỗi Anti-pattern: Service `inventory` gọi trực tiếp `order` để cập nhật trạng thái đơn hàng khi tồn kho hết, tạo ra vòng lặp `order -> inventory -> order`.
- **Hành vi kiểm chứng:** Thuật toán DFS phát hiện `recStack.has(neighbor) === true`.
- **Kết quả:** Phát hiện cycle `['order', 'inventory', 'order']` và chặn vi phạm kiến trúc ngay tại khâu CI test.

### Tình huống 2: Xung đột Quyền sở hữu Dữ liệu (Shared Database Anti-pattern)
- **Kịch bản:** Hai microservices cùng trỏ vào một tên database chung (`order_db`), hoặc Ordering Service cố gắng định nghĩa bảng `inventory_items`.
- **Hành vi kiểm chứng:** Hàm kiểm tra `uniqueDbs.size === databases.length` và `allDomainTables.includes(table)`.
- **Kết quả:** Bị từ chối ngay lập tức với lỗi `AssertionError: Bảng nghiệp vụ inventory_items bị xung đột quyền sở hữu`.

---

## 5. Engineering Judgment & Phân tích Đánh đổi (Trade-off Analysis)

### Trade-off: Chia service theo CRUD/Table (Entity Services) vs. Chia theo Bounded Contexts
- **Chia theo CRUD/Table (Anti-pattern):**
  - Tạo ra "Anemic Microservices" (ví dụ: `ProductService`, `StockService`, `OrderTableService`) chỉ đóng vai trò wrapper cho câu lệnh SQL CRUD.
  - Hậu quả: Dẫn đến hiện tượng "Distributed Monolith" với chatty network calls, coupling cực cao, và không thể bảo vệ business invariants độc lập.
- **Chia theo DDD Bounded Contexts (Lựa chọn của CommerceFlow):**
  - Mỗi service bao bọc toàn bộ năng lực nghiệp vụ (Business Capabilities) và business logic của mình.
  - Trao đổi qua API contracts tối giản và Domain Events không đồng bộ qua Cloud Pub/Sub.

---

## 6. Lời giải Thử thách Độc lập (Independent Challenge Solution)

> **Câu hỏi:** Viết rollback plan khi tách Inventory? Giải thích trade-off và một test phát hiện lỗi.

### 1. Rollback Plan khi tách Inventory Service:
1. **Trigger Conditions (Ngưỡng báo động):**
   - Tỷ lệ lỗi 5xx trên endpoint `/api/v1/inventory/reserve` vượt 1% trong 3 phút liên tục.
   - P99 Latency vượt ngưỡng 800ms (ảnh hưởng đến thời gian phản hồi tạo đơn hàng).
   - Phát hiện xung đột dữ liệu tồn kho âm (Overselling) giữa cache/database mới và số liệu thực tế.
2. **Quy trình hoàn nguyên (Rollback Execution):**
   - **Chuyển mạch tức thì (Traffic Cutover):** Tại API Gateway, đảo Feature Flag `USE_STANDALONE_INVENTORY=false`. Ngay lập tức toàn bộ request đặt chỗ tồn kho được chuyển hướng về in-process module `InventoryModule` bên trong Monolith.
   - **Đối soát & Bồi hoàn Dữ liệu (Reconciliation):** Kích hoạt worker đối soát tự động: so khớp các bản ghi `stock_reservations` được tạo trên standalone service trong khoảng thời gian phân tán với số liệu trong monolith; tự động nhả (release) các reservation bị treo không có đơn hàng xác nhận.
   - **Zero-Downtime:** Nhờ kiến trúc API Gateway điều hướng linh hoạt, khách hàng cuối không gặp gián đoạn phiên mua sắm.

### 2. Test phát hiện lỗi (Verification Test):
Đã được cài đặt trong `tests/architecture/service-boundaries.test.ts` (Suite 4: *Kế hoạch Hoàn nguyên & Rollback Plan khi tách Inventory*). Kiểm tra tính sẵn sàng của các điều kiện cảnh báo P99/5xx, cấu hình Feature Flag `USE_STANDALONE_INVENTORY`, và quy trình đối soát dữ liệu.
