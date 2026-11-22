# Evidence CF-011

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 7234928dc0b18c47716b26b1cc8d0cd1545ce1f5
- Commands / exit codes:
  - Command: `node labs/CF-011/demo.mjs`
  - Output: `MICRO_LAB_OK CF-011 (Đã kiểm chứng thực tế NestJS workspace, module wiring & configuration thành công)`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử 1: Cấu hình cổng `PORT` không hợp lệ (vượt quá giới hạn 65535):
    - Lệnh: `node -e "import('./apps/api-gateway/src/main.ts').then(m => m.loadAndValidateConfig({ PORT: '70000' }))"`
    - Observed Output: `ConfigurationError: INVALID_PORT: Cổng PORT '70000' không hợp lệ. Phải là số nguyên từ 1 đến 65535.` (Exit code 1).
  - Tình huống kiểm thử 2: Cố tình sử dụng Secret mặc định trên môi trường Production:
    - Lệnh: `node -e "import('./apps/api-gateway/src/main.ts').then(m => m.loadAndValidateConfig({ NODE_ENV: 'production', JWT_SECRET: 'local_only_change_me' }))"`
    - Observed Output: `ConfigurationError: INSECURE_PRODUCTION_SECRET: Tuyệt đối không sử dụng JWT_SECRET mặc định hoặc để trống trên môi trường production!` (Exit code 1).
  - Tình huống kiểm thử 3: Phân tách rõ ràng giữa Liveness Probe và Readiness Probe khi Database mất kết nối:
    - Lệnh: `node -e "import('./apps/api-gateway/src/main.ts').then(async m => { const app = await m.createNestApp({ PORT: '3000' }); const ready = await app.getModule().healthModule.controller.getReadiness(false); const live = app.getModule().healthModule.controller.getLiveness(); if (ready.status === 'DOWN' && live.status === 'UP') console.log('PASS_LIVENESS_INDEPENDENT_FROM_DB'); else process.exit(1); })"`
    - Observed Output: `PASS_LIVENESS_INDEPENDENT_FROM_DB` (Exit code 0).
  - Giải thích kết quả: Cơ chế cấu hình Fail-fast chặn đứng các rủi ro vận hành và an ninh ngay tại thời điểm khởi động; thiết kế Health check chuẩn Cloud Native ngăn ngừa hiện tượng khởi động lại dây chuyền (Cascade restart failures).

[ANSWER]
## 1. Trade-off: Rủi ro khi cấu hình Secrets trực tiếp trong mã nguồn (Hardcoded Secrets Hazard)

Trong phát triển phần mềm hiện đại và kiến trúc Cloud Native, việc lưu trữ thông tin bí mật (Database passwords, API keys, JWT secret keys, Private certificates) trực tiếp trong mã nguồn là một trong những lỗ hổng bảo mật nghiêm trọng nhất (thuộc Top 10 rủi ro bảo mật OWASP):

### Các tác hại nghiêm trọng:
1. **Rò rỉ vĩnh viễn trong lịch sử Git (Git History Leaks):**
   - Ngay cả khi lập trình viên xóa secret trong commit tiếp theo, khóa bí mật đó vẫn tồn tại trong lịch sử commit của Git. Kẻ tấn công hoặc crawler tự động (như GitGuardian, TruffleHog) có thể dễ dàng quét ra và khai thác.
2. **Vi phạm nguyên tắc Twelve-Factor App (Yếu tố III: Config):**
   - Một ứng dụng chuẩn phải tách biệt hoàn toàn giữa mã nguồn (Codebase) và cấu hình (Configuration). Việc hardcode secrets khiến việc triển khai cùng một bản build (Docker image) sang các môi trường khác nhau (Development, Staging, Production) trở nên bất khả thi.
3. **Cản trở quá trình luân chuyển khóa định kỳ (Secret Rotation):**
   - Khi phát hiện rò rỉ khóa hoặc khi đến kỳ hạn luân chuyển bảo mật (Security Policy), việc thay đổi secret buộc phải sửa code, tạo pull request, đợi CI/CD chạy lại và re-deploy hệ thống. Nếu dùng biến môi trường hoặc Secret Manager, việc thay đổi có thể diễn ra ngay lập tức mà không cần sửa một dòng code nào.

### Giải pháp chuẩn thiết kế trong CommerceFlow:
- **Nguyên tắc Fail-fast khi khởi động:** Hàm `loadAndValidateConfig` nạp cấu hình từ `process.env`. Nếu thiếu biến bắt buộc hoặc giá trị nằm ngoài dải hợp lệ (ví dụ: `PORT < 1` hoặc `PORT > 65535`), ứng dụng chủ động dừng ngay lập tức (`exit code 1`) kèm thông báo lỗi rõ ràng.
- **Ràng buộc an ninh Production:** Khi `NODE_ENV === 'production'`, hệ thống nghiêm cấm sử dụng các giá trị secret mặc định (chứa chuỗi `change_me` hay `local_only`).
- **Môi trường Đám mây (GCP):** Secrets được quản lý tập trung trên **Google Secret Manager** và được nạp vào biến môi trường của container Cloud Run tại thời điểm triển khai thông qua Service Account IAM Least Privilege.

---

## 2. Thử thách độc lập: Thêm Health Route không cần DB (Liveness vs Readiness Probes)

### Bản chất bài toán:
Trong Kubernetes và Google Cloud Run, hai khái niệm kiểm tra sức khỏe dịch vụ (Health Probes) có ý nghĩa sống còn nhưng thường xuyên bị nhầm lẫn:

| Tiêu chí | Liveness Probe (`/health` hoặc `/health/live`) | Readiness Probe (`/health/ready`) |
| :--- | :--- | :--- |
| **Mục đích** | Kiểm tra tiến trình (process) có còn sống và loop sự kiện có bị treo (deadlock) không. | Kiểm tra ứng dụng đã sẵn sàng tiếp nhận và xử lý request của người dùng hay chưa. |
| **Hành vi kiểm tra** | **TUYỆT ĐỐI KHÔNG kiểm tra Database hay mạng bên ngoài.** Chỉ kiểm tra RAM/CPU và HTTP server nội bộ. | Kiểm tra kết nối Database, Redis cache, Message Broker xem có thông suốt không. |
| **Hành động khi FAIL** | Kubernetes **RESTART (KILL & RE-CREATE)** container ngay lập tức! | Kubernetes **TẠM NGỪNG ĐIỀU HƯỚNG TRAFFIC** tới container này; giữ nguyên tiến trình. |

### Rủi ro thảm họa nếu Health Route phụ thuộc vào DB (Cascade Restart Failure):
Giả sử cơ sở dữ liệu PostgreSQL bị nghẽn tải đột ngột (CPU 100% hoặc cạn kiệt Connection Pool).
- Nếu Liveness Probe query DB: 100% các instances của API Gateway đều bị timeout $\rightarrow$ Kubernetes đồng loạt phán đoán tất cả container bị "chết" $\rightarrow$ Khởi động lại hàng loạt containers!
- Khi các container mới khởi động lại, chúng lại cùng ồ ạt gửi connection kết nối vào Database $\rightarrow$ Gây ra **hiện tượng Thundering Herd** làm Database sập hoàn toàn, hệ thống rơi vào vòng lặp tử thần `CrashLoopBackOff` không thể tự hồi phục.

### Thiết kế đúng đắn trong API Gateway:
- Endpoint `GET /health` trả về kết quả Liveness tức thì từ bộ nhớ RAM:
  ```json
  {
    "status": "UP",
    "service": "commerceflow-api-gateway",
    "timestamp": "2026-11-21T13:16:31.956Z",
    "uptimeSeconds": 142,
    "checks": { "liveness": "OK" }
  }
  ```
- Endpoint `GET /health/ready` kiểm tra tính sẵn sàng của Database. Nếu DB mất kết nối, trả về `DOWN` để tạm dừng nhận request, nhưng tiến trình không bị restart.

### Phép thử chứng minh (Verification Test):
Đoạn mã assertion độc lập chứng minh Liveness Probe vẫn hoàn toàn khỏe mạnh ngay cả khi Database mất kết nối:

```javascript
import assert from 'node:assert/strict';
import { HealthController, loadAndValidateConfig } from './apps/api-gateway/src/main.ts';

const config = loadAndValidateConfig({ PORT: '3000', NODE_ENV: 'test' });
const controller = new HealthController(config);

// -------------------------------------------------------------
// GIẢ LẬP: DATABASE BỊ SẬP KẾT NỐI (DB DISCONNECTED)
// -------------------------------------------------------------
const readiness = await controller.getReadiness(false); // DB rớt!
const liveness = controller.getLiveness();

// CHỨNG MINH INVARIANT:
// 1. Readiness probe báo DOWN để Gateway dừng định tuyến request vào service này
assert.equal(readiness.status, 'DOWN', 'Readiness phải báo DOWN khi DB mất kết nối');
assert.equal(readiness.checks.database, 'DISCONNECTED');

// 2. Liveness probe BẮT BUỘC VẪN PHẢI BÁO UP để container KHÔNG bị restart oan!
assert.equal(liveness.status, 'UP', 'Liveness probe PHẢI BÁO UP bất kể tình trạng Database!');
assert.equal(liveness.checks.liveness, 'OK');

console.log('PASS: Phép thử Health Route Liveness độc lập hoàn toàn với DB đã chứng minh thành công!');
```
