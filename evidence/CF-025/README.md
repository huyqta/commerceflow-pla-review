# Evidence CF-025: Product Management và Inventory Dashboard

## 1. Thông tin tổng quan
- **Issue ID:** CF-025
- **Milestone:** M5 (Web Application & Full-Stack Integration)
- **Loại:** `implementation`
- **Mục tiêu:** Tạo data fetching, loading/empty/error states và bảng điều khiển tồn kho thời gian thực.
- **Môi trường:** Node.js v24.12.0 trên Windows 11.
- **Thời gian thực hiện:** 2026-11-22.

---

## 2. Artifacts & Deliverables đã tạo
1. `apps/web/src/features/catalog/ProductList.tsx` (và `apps/web/src/features/catalog/ProductList.ts`):
   - Cài đặt `ProductListComponent` quản trị 4 trạng thái giao diện:
     - **Loading State:** `role="status"`, `aria-busy="true"`, `aria-live="polite"`.
     - **Error State:** `role="alert"`, `aria-live="assertive"`, nút "Thử lại" (Retry Action).
     - **Empty State:** `role="region"`, thông điệp danh mục rỗng và Call-To-Action (CTA) link `Thêm sản phẩm đầu tiên` trỏ về `/products/new` (Thử thách độc lập).
     - **Data State:** Bảng dữ liệu sản phẩm chuẩn ngữ nghĩa (`<table>`, `<th scope="col">`), hiển thị SKU, tên, giá, tồn kho khả dụng (badge màu xanh khi còn hàng, badge màu đỏ khi hết hàng), và số lượng đang giữ (Reserved).
   - Hàm `resolveViewState(state)`: Phân loại trạng thái giao diện dựa trên bộ ba `(loading, error, items)`.
2. `tests/web/product-list.test.ts`:
   - Bộ 6 automated tests bao phủ toàn diện: phân loại view state, render loading với accessibility attributes, render error với alert role, thiết kế empty state với CTA, render bảng data và tồn kho, và chống rủi ro stale cache server state.
3. `labs/CF-025/demo.mjs`:
   - Micro-lab độc lập kiểm tra assertion: `assert.equal(view({loading:false,error:null,items:[]}), 'empty');`.

---

## 3. Nhật ký kiểm thử & Thực thi lệnh

### 3.1. Chạy Micro-lab
```bash
node labs/CF-025/demo.mjs
```
- **Exit Code:** 0
- **Output:**
```
MICRO_LAB_OK CF-025
```

### 3.2. Chạy Automated Unit Tests CF-025
```bash
node --experimental-strip-types --test tests/web/product-list.test.ts
```
- **Exit Code:** 0
- **Output:**
```
▶ CF-025: Product Management and Inventory Dashboard
  ✔ should accurately resolve view states (loading, error, empty, data) (0.6614ms)
  ✔ should render loading state with accessibility attributes (0.2657ms)
  ✔ should render error state with alert role and retry action (0.8505ms)
  ✔ Independent Challenge: should design meaningful empty state with clear call to action (0.1284ms)
  ✔ should render data state with product table and inventory badges (18.1932ms)
  ✔ Trade-off & Negative Case: avoid stale server state caching by updating timestamp (0.245ms)
✔ CF-025: Product Management and Inventory Dashboard (21.3245ms)
ℹ tests 6
ℹ suites 1
ℹ pass 6
ℹ fail 0
```

### 3.3. Chạy Toàn bộ Test Suite Hồi quy (123 tests pass)
```bash
node --experimental-strip-types --test tests/architecture/order-boundary.test.ts tests/database/order-schema.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/api/catalog-api.test.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts tests/messaging/event-bus.test.ts tests/messaging/outbox-inbox.test.ts tests/order/order-saga.test.ts tests/messaging/resilience-retry.test.ts tests/web/ui-shell.test.ts tests/web/product-list.test.ts
```
- **Exit Code:** 0
- **Kết quả:** 123 tests passed, 0 failures.

---

## 4. Negative Test Cases & Boundary Checks
1. **Negative Case: Caching Server State sai cách (Hiển thị dữ liệu cũ khi danh mục đã bị xóa sạch):**
   - *Input:* Component đã từng có dữ liệu sản phẩm, sau đó server phản hồi mảng rỗng `[]` (ví dụ sau khi reset dữ liệu).
   - *Kỳ vọng:* Component không được giữ lại cache cũ (`stale data`), mà phải cập nhật `lastFetchedAt` và chuyển ngay lập tức sang `Empty State`.
   - *Thực tế:* Test `Trade-off & Negative Case: avoid stale server state caching by updating timestamp` xác nhận `view.stateKind = 'empty'` và thời gian fetch được làm mới.
2. **Negative Case: Tồn kho bằng 0 hoặc âm (Out of Stock Boundary):**
   - *Input:* Sản phẩm có `availableStock = 0`.
   - *Kỳ vọng:* Không hiển thị số 0 bình thường mà phải gắn nhãn cảnh báo nguy hiểm (`badge-danger: Hết hàng`) để nhân viên bán hàng không đặt nhầm.
   - *Thực tế:* Test `should render data state with product table and inventory badges` kiểm chứng chính xác badge "Hết hàng".

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Cache server state sai cách (Stale Server State Anti-Pattern)
- **Hiểu lầm phổ biến:** Lưu trữ toàn bộ dữ liệu server vào Global Client State (như Redux, Zustand) mà không có cơ chế invalidation hoặc timestamp.
- **Rủi ro thực tế:**
  1. *Overselling trên giao diện:* Người dùng thấy sản phẩm vẫn còn tồn kho (do đọc từ local cache cũ), nhấn nút mua nhưng thực chất phía Inventory Service đã hết hàng từ 10 phút trước.
  2. *Xung đột trạng thái (State Desynchronization):* Dữ liệu danh mục thay đổi trên server nhưng client không tự động làm mới, dẫn đến việc gửi các mã SKU đã bị lưu trữ (archived).
- **Giải pháp chuẩn:**
  - Luôn quản lý vòng đời dữ liệu máy chủ rõ ràng: `loading`, `error`, `empty`, `data`.
  - Đính kèm mốc thời gian `lastFetchedAt` để kiểm soát độ tươi mới của dữ liệu (freshness).

### 5.2. Thử thách độc lập: Thiết kế Empty State (Trải nghiệm người dùng khi chưa có dữ liệu)
- **Ý nghĩa thiết kế:**
  - Một trang trắng trơn (blank page) hoặc chỉ hiện thông báo đơn điệu "Không có dữ liệu" khiến người dùng nghĩ rằng hệ thống bị lỗi mạng hoặc treo giao diện.
  - Một **Empty State** chuẩn công nghiệp cần 4 thành phần:
    1. Hình ảnh minh họa trực quan (Icon hộp rỗng).
    2. Tiêu đề rõ ràng ("Danh mục sản phẩm hiện đang rỗng").
    3. Lời giải thích ngắn gọn lý do tại sao rỗng.
    4. Nút hành động kêu gọi (Call to action - CTA): Nút "Thêm sản phẩm đầu tiên" trỏ đến form tạo sản phẩm `/products/new`.
- **Kiểm chứng qua kiểm thử:**
  - Test `Independent Challenge: should design meaningful empty state with clear call to action` xác nhận đầy đủ các yếu tố trên.
