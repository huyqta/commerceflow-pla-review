# Evidence CF-024: ReactJS/Vite routing và UI shell

## 1. Thông tin tổng quan
- **Issue ID:** CF-024
- **Milestone:** M5 (Web Application & Full-Stack Integration)
- **Loại:** `implementation`
- **Mục tiêu:** Xây dựng navigation, route layout và accessible UI shell cho ứng dụng web CommerceFlow. Đảm bảo hỗ trợ các routes nghiệp vụ `/products`, `/inventory`, `/orders`, trang 404 Not Found, và tách bạch giữa Data Fetching và UI Presentation.
- **Môi trường:** Node.js v24.12.0 trên Windows 11.
- **Thời gian thực hiện:** 2026-11-22.

---

## 2. Artifacts & Deliverables đã tạo
1. `apps/web/src/App.tsx` (và `apps/web/src/App.ts` tương thích với Node.js native execution):
   - Cung cấp lớp `AppShell` điều phối giao diện, responsive navigation menu, header, footer và content area.
   - Sử dụng các ARIA landmarks chuẩn W3C: `role="banner"`, `role="navigation"`, `role="main"`, `role="contentinfo"`, `aria-label="Main Navigation"`, `aria-current="page"`, `role="alert"` (cho trang 404).
   - Render cấu trúc HTML ngữ nghĩa sạch sẽ, hỗ trợ SSR và client routing.
2. `apps/web/src/routes.ts`:
   - Định nghĩa danh sách routes chính: `/` (Dashboard), `/products` (Catalog Management), `/inventory` (Inventory Dashboard), `/orders` (Order Management & Saga Tracking), `/login`.
   - Hàm `matchRoute()`: khớp chính xác route và fallback sang trang 404 Not Found khi đường dẫn không tồn tại.
   - Hàm `getNavRoutes()`: lọc các route hiển thị trên thanh điều hướng.
3. `apps/web/src/services/api-client.ts`:
   - Lớp `WebApiClient` và interface `IApiClient` tách bạch hoàn toàn tầng Data Fetching khỏi tầng UI Presentation.
4. `tests/web/ui-shell.test.ts`:
   - Bộ 6 automated tests bao phủ: định nghĩa core routes, render HTML landmarks, cập nhật active route khi chuyển trang, điều hướng trang 404, xử lý URL không chuẩn (negative case), và kiểm chứng separation of concerns.
5. `labs/CF-024/demo.mjs`:
   - Micro-lab độc lập xác nhận các core routes: `['/products', '/inventory', '/orders']`.

---

## 3. Nhật ký kiểm thử & Thực thi lệnh

### 3.1. Chạy Micro-lab
```bash
node labs/CF-024/demo.mjs
```
- **Exit Code:** 0
- **Output:**
```
MICRO_LAB_OK CF-024
```

### 3.2. Chạy Automated Unit Tests CF-024
```bash
node --experimental-strip-types --test tests/web/ui-shell.test.ts
```
- **Exit Code:** 0
- **Output:**
```
▶ CF-024: ReactJS/Vite Routing and Accessible UI Shell
  ✔ should define core navigation routes according to requirements (/products, /inventory, /orders) (0.6412ms)
  ✔ should match known routes and render appropriate views with semantic ARIA roles (0.3988ms)
  ✔ should update active state when navigating to different routes (0.1814ms)
  ✔ Independent Challenge: should route unknown paths to 404 Not Found Page (0.1798ms)
  ✔ Negative Case: should handle malformed or dirty URLs safely (0.1354ms)
  ✔ Trade-off: should enforce Separation of Concerns between API Client and UI Presentation (0.168ms)
✔ CF-024: ReactJS/Vite Routing and Accessible UI Shell (2.655ms)
ℹ tests 6
ℹ suites 1
ℹ pass 6
ℹ fail 0
```

### 3.3. Chạy Toàn bộ Test Suite Hồi quy (117 tests pass)
```bash
node --experimental-strip-types --test tests/architecture/order-boundary.test.ts tests/database/order-schema.test.ts tests/inventory/inventory-reservation.test.ts tests/order/order-lifecycle.test.ts tests/api/catalog-api.test.ts tests/architecture/service-boundaries.test.ts tests/standalone/catalog-inventory-standalone.test.ts tests/contracts/order-contract.test.ts tests/messaging/event-bus.test.ts tests/messaging/outbox-inbox.test.ts tests/order/order-saga.test.ts tests/messaging/resilience-retry.test.ts tests/web/ui-shell.test.ts
```
- **Exit Code:** 0
- **Kết quả:** 117 tests passed, 0 failures.

---

## 4. Negative Test Cases & Boundary Checks
1. **Negative Case: URL chứa ký tự thừa, khoảng trắng hoặc Query/Hash Parameters:**
   - *Input:* Đường dẫn không chuẩn: `'  /PRODUCTS?sort=desc#section1  '`.
   - *Kỳ vọng:* Hệ thống route matcher chuẩn hóa an toàn (loại bỏ query params, hash fragments, trim whitespace, lowercase) và khớp thành công với route `/products`.
   - *Thực tế:* Test `should handle malformed or dirty URLs safely` kiểm chứng `match.matched = true`, `match.is404 = false`.
2. **Negative Case: Đường dẫn hoàn toàn không tồn tại (404 Fallback):**
   - *Input:* Đường dẫn rác: `'/non-existent-page-xyz'`.
   - *Kỳ vọng:* Trả về `match.is404 = true`, UI Shell render trang 404 với `role="alert"` để screen reader thông báo ngay lập tức cho người khiếm thị.
   - *Thực tế:* Test `Independent Challenge: should route unknown paths to 404 Not Found Page` xác nhận hiển thị thông điệp 404 rõ ràng kèm đường dẫn bị thiếu.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Trộn API Fetch và UI Presentation (Anti-Pattern)
- **Hiểu lầm phổ biến:** Nhúng trực tiếp các lệnh `fetch()` hoặc `axios.get()` bên trong thân component React (`useEffect` hoặc event handlers) giúp viết code nhanh hơn.
- **Rủi ro kỹ thuật:**
  1. *Khó Unit Test:* Không thể kiểm thử giao diện (UI Shell, Layout, Rendering) một cách độc lập nếu component bị gắn chặt với network endpoint cụ thể.
  2. *Vi phạm Separation of Concerns:* Giao diện người dùng bị phụ thuộc vào chi tiết hạ tầng HTTP (headers, base URL, JWT token format).
  3. *Tái sử dụng kém:* Khi cần thay đổi cơ chế caching, đổi endpoint backend từ Monolith sang Microservices hoặc Gateway, toàn bộ các components giao diện đều phải sửa lại.
- **Giải pháp chuẩn CommerceFlow:**
  - Định nghĩa interface `IApiClient` và tách thành module riêng (`apps/web/src/services/api-client.ts`).
  - UI Shell (`AppShell` / `App.tsx`) chỉ nhận `apiClient` qua dependency injection hoặc props, giữ cho tầng trình diễn hoàn toàn độc lập và thuần túy hiển thị dữ liệu.

### 5.2. Thử thách độc lập: Thiết kế Trang 404 Not Found & Khả năng Tiếp cận (Accessibility)
- **Thiết kế:**
  - Route matcher kiểm tra toàn bộ danh mục đường dẫn đã đăng ký trong `APP_ROUTES`. Nếu không tìm thấy, trả về kết quả `is404: true`.
  - Giao diện 404 được gán thuộc tính `role="alert"` để người dùng sử dụng trình đọc màn hình (Screen Readers) ngay lập tức biết rằng trang đích không tồn tại mà không bị hoang mang.
  - Cung cấp nội dung giải thích trực quan: hiển thị chính xác đường dẫn người dùng vừa nhập và hướng dẫn quay lại Dashboard.
