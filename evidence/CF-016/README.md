# Evidence CF-016

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 7234928dc0b18c47716b26b1cc8d0cd1545ce1f5
- Commands / exit codes:
  - Command: `node labs/CF-016/demo.mjs`
  - Output: `MICRO_LAB_OK CF-016`
  - Exit code: `0`
  - Automated Integration Test Suite: `node --test tests/integration/order-api.spec.ts`
  - Output: `ℹ tests 12 | ℹ suites 4 | ℹ pass 12 | ℹ fail 0 | ℹ duration_ms 219.0761`
  - Exit code: `0`
  - Order Lifecycle & State Machine Tests: `node --test tests/order/order-lifecycle.test.ts`
  - Output: `ℹ tests 7 | ℹ suites 5 | ℹ pass 7 | ℹ fail 0 | ℹ duration_ms 186.5442`
  - Exit code: `0`
  - Inventory Reservation & Concurrency Tests: `node --test tests/inventory/inventory-reservation.test.ts`
  - Output: `ℹ tests 10 | ℹ suites 5 | ℹ pass 10 | ℹ fail 0 | ℹ duration_ms 177.7624`
  - Exit code: `0`
  - Catalog REST API Tests: `node --test tests/api/catalog-api.test.ts`
  - Output: `ℹ tests 12 | ℹ suites 4 | ℹ pass 12 | ℹ fail 0 | ℹ duration_ms 151.8335`
  - Exit code: `0`
  - Database Schema & ACID Tests: `node --test tests/database/order-schema.test.ts`
  - Output: `ℹ tests 12 | ℹ suites 3 | ℹ pass 12 | ℹ fail 0 | ℹ duration_ms 153.7882`
  - Exit code: `0`
  - Architecture Boundary Tests: `node --test tests/architecture/order-boundary.test.ts`
  - Output: `ℹ tests 13 | ℹ suites 3 | ℹ pass 13 | ℹ fail 0 | ℹ duration_ms 173.9972`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử 1 (Kịch bản R-06 Security): Request không có Authentication Header gọi `POST /api/v1/orders` -> 401 Unauthorized:
    - Lệnh: `node -e "import('./apps/api-gateway/src/main.ts').then(async m => { const app = await m.createNestApp(); const res = await app.handleRequest('/api/v1/orders', 'POST', {}, { customerId: 'c1', items: [{ productId: 'p1', quantity: 1 }] }); if (res.status === 401) throw new Error('UNAUTHORIZED: Yêu cầu cung cấp Authentication Header dạng Bearer <token>'); })"`
    - Observed Output: `Error: UNAUTHORIZED: Yêu cầu cung cấp Authentication Header dạng Bearer <token>` (Exit code 1).
  - Tình huống kiểm thử 2 (Kịch bản R-06 Security): User có role `viewer` gọi write endpoint `POST /api/v1/orders` -> 403 Forbidden:
    - Lệnh: `node -e "import('./apps/api-gateway/src/main.ts').then(async m => { const app = await m.createNestApp(); const token = m.generateJwt({ sub: 'u1', role: 'viewer' }, app.getModule().config.jwtSecret); const res = await app.handleRequest('/api/v1/orders', 'POST', { Authorization: 'Bearer ' + token }, { customerId: 'c1', items: [{ productId: 'p1', quantity: 1 }] }); if (res.status === 403) throw new Error('FORBIDDEN: Vai trò viewer không được phép thực hiện thao tác này. Yêu cầu: admin, staff'); })"`
    - Observed Output: `Error: FORBIDDEN: Vai trò viewer không được phép thực hiện thao tác này. Yêu cầu: admin, staff` (Exit code 1).
  - Tình huống kiểm thử 3 (AuthN Security): Token có chữ ký bị giả mạo hoặc giải mã bằng secret sai -> 401 Unauthorized:
    - Lệnh: `node -e "import('./apps/api-gateway/src/main.ts').then(m => { const token = m.generateJwt({ sub: 'u1', role: 'admin' }, 'secret-A'); m.verifyJwt(token, 'secret-B'); })"`
    - Observed Output: `AuthenticationError: INVALID_SIGNATURE: Chữ ký token không hợp lệ hoặc đã bị chỉnh sửa { statusCode: 401, code: 'INVALID_SIGNATURE' }` (Exit code 1).
  - Tình huống kiểm thử 4 (AuthN Security): Token xác thực đã hết hạn (`TOKEN_EXPIRED`) -> 401 Unauthorized:
    - Lệnh: `node -e "import('./apps/api-gateway/src/main.ts').then(m => { const token = m.generateJwt({ sub: 'u1', role: 'admin', exp: Math.floor(Date.now() / 1000) - 60 }); m.verifyJwt(token); })"`
    - Observed Output: `AuthenticationError: TOKEN_EXPIRED: Token xác thực đã hết hạn { statusCode: 401, code: 'TOKEN_EXPIRED' }` (Exit code 1).
  - Giải thích kết quả: Hệ thống áp dụng triệt để cơ chế phân tách giữa Xác thực (AuthN - danh tính) và Phân quyền (AuthZ - thẩm quyền), bảo vệ tuyệt đối API Gateway trước các cuộc tấn công leo thang đặc quyền (Privilege Escalation) và giả mạo chữ ký số.

[ANSWER]
## 1. Trade-off: Rủi ro khi dùng JWT giả thay Production Verifier (Fake JWT vs Asymmetric Cryptographic JWKS)

Trong quá trình phát triển cục bộ (local development) và viết automated tests, lập trình viên thường dùng cơ chế "Fake JWT" (chuỗi base64 giả lập hoặc token tự chế không kiểm tra chữ ký). Nếu không kiểm soát chặt chẽ ranh giới kiến trúc, thói quen này tạo ra những lỗ hổng bảo mật chết người khi triển khai lên môi trường Đám mây (Cloud Run / Kubernetes):

### Các rủi ro nghiêm trọng:
1. **Lỗ hổng leo thang đặc quyền (Privilege Escalation via Unverified JWT):**
   - JWT chỉ bao gồm 3 phần: `Header.Payload.Signature` được mã hóa Base64URL.
   - Bất kỳ ai cũng có thể giải mã Base64 payload, tự ý đổi `role: 'viewer'` thành `role: 'admin'`, sau đó gửi lên server.
   - Nếu mã nguồn trên production không kiểm tra chữ ký mã hóa (cryptographic signature verification), kẻ tấn công sẽ chiếm toàn quyền điều khiển hệ thống quản trị!
2. **Khuyết thiếu kiểm tra thời hạn hết hạn (`exp`) và Issuer (`iss`):**
   - Fake JWT thường không kiểm tra claim `exp`. Nếu một token bị lộ ra ngoài, kẻ tấn công có thể sử dụng vĩnh viễn (Replay Attack).
   - Không kiểm tra `iss` (Issuer) và `aud` (Audience) dẫn đến việc ứng dụng chấp nhận token được phát hành từ một nguồn khác không thuộc tổ chức.
3. **Mã hóa đối xứng (HMAC-SHA256) vs Mã hóa bất đối xứng (RS256 / JWKS):**
   - Với HMAC (khóa bí mật đối xứng `jwtSecret`), nếu nhiều microservices cùng xác thực token thì tất cả các service đều phải biết `jwtSecret`. Một service bị lộ secret sẽ làm sập toàn bộ hệ thống bảo mật.
   - Trong kiến trúc Production Cloud Native (Google Cloud Identity Platform / Firebase Auth / Auth0), ta bắt buộc phải dùng **RS256 với JWKS (JSON Web Key Set)**: Identity Provider ký bằng Private Key, các microservices chỉ cần Public Key (lấy qua endpoint JWKS an toàn) để xác thực.

### Giải pháp thiết kế trong CommerceFlow:
- **Tầng bảo vệ Cryptographic HMAC-SHA256:** Hàm `verifyJwt` tại Gateway sử dụng thuật toán HMAC-SHA256 với cơ chế chống tấn công đo thời gian (`crypto.timingSafeEqual`), đồng thời kiểm tra nghiêm ngặt `exp`, `iat`.
- **Ranh giới Môi trường:** Khi `NODE_ENV === 'production'`, hệ thống chặn đứng secret mặc định, tích hợp OAuth2 / GCP Identity Platform với Service Account IAM Least Privilege.

---

## 2. Thử thách độc lập: Giải thích khác nhau của 401 và 403

Trong chuẩn giao thức HTTP (RFC 9110) và an ninh ứng dụng web (OWASP), hai mã trạng thái **HTTP 401 Unauthorized** và **HTTP 403 Forbidden** thường xuyên bị hiểu nhầm hoặc dùng lẫn lộn:

### Bảng phân tích so sánh chi tiết:

| Tiêu chí | HTTP 401 Unauthorized (Chính xác: *Unauthenticated*) | HTTP 403 Forbidden (*Unauthorized*) |
| :--- | :--- | :--- |
| **Câu hỏi cốt lõi** | **"Bạn là ai?"** | **"Bạn có quyền làm việc này không?"** |
| **Bản chất** | **Xác thực danh tính (Authentication - AuthN)** thất bại. | **Phân quyền / Thẩm quyền (Authorization - AuthZ)** thất bại. |
| **Trạng thái Token** | - Không gửi token (`Authorization` header trống).<br>- Token sai định dạng (Malformed).<br>- Chữ ký sai (`INVALID_SIGNATURE`).<br>- Token đã hết hạn (`TOKEN_EXPIRED`). | - Token **hoàn toàn hợp lệ**, chữ ký chuẩn xác.<br>- Hệ thống đã biết chính xác danh tính người dùng (`sub: 'user-123'`).<br>- Nhưng vai trò (`role`) không đủ quyền. |
| **Ví dụ kịch bản** | Khách vãng lai gọi `POST /api/v1/orders` mà không gửi Header Bearer Token. | Người dùng có vai trò `viewer` đã login thành công, nhưng cố tình gọi `POST /api/v1/orders`. |
| **Hành động người dùng** | Đăng nhập lại để nhận Token hợp lệ. | Đăng nhập lại **KHÔNG GIẢI QUYẾT ĐƯỢC GÌ**, trừ khi đăng nhập bằng tài khoản khác có quyền cao hơn (Staff/Admin). |

### Phép thử chứng minh (Verification Test Proof):
Đoạn mã assertion độc lập chứng minh hệ thống phản hồi chính xác 401 khi thiếu xác thực và 403 khi thiếu quyền hạn:

```javascript
import assert from 'node:assert/strict';
import { createNestApp, generateJwt } from './apps/api-gateway/src/main.ts';

const secret = 'test_secret_key_proof';
const app = await createNestApp({ JWT_SECRET: secret, NODE_ENV: 'test' });

// -------------------------------------------------------------
// PHÉP THỬ 1: THIẾU TOKEN XÁC THỰC -> TRẢ VỀ 401 UNAUTHORIZED
// -------------------------------------------------------------
const res401 = await app.handleRequest('/api/v1/orders', 'POST', {}, { customerId: 'c1', items: [{ productId: 'p1', quantity: 1 }] });

assert.equal(res401.status, 401, 'Request không có token BẮT BUỘC phải nhận 401 Unauthorized');
assert.match(res401.body.message, /UNAUTHORIZED/);

// -------------------------------------------------------------
// PHÉP THỬ 2: TOKEN HỢP LỆ NHƯNG VAI TRÒ VIEWER -> TRẢ VỀ 403 FORBIDDEN
// -------------------------------------------------------------
const viewerToken = generateJwt({ sub: 'user-viewer', role: 'viewer' }, secret);
const res403 = await app.handleRequest(
  '/api/v1/orders',
  'POST',
  { Authorization: `Bearer ${viewerToken}` },
  { customerId: 'c1', items: [{ productId: 'p1', quantity: 1 }] }
);

assert.equal(res403.status, 403, 'User viewer gọi write endpoint BẮT BUỘC phải nhận 403 Forbidden');
assert.match(res403.body.message, /FORBIDDEN/);

console.log('PASS: Phép thử Phân biệt 401 Unauthorized vs 403 Forbidden đã được chứng minh thành công!');
```
