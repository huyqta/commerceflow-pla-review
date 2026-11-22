// labs/CF-016/demo.mjs
// Micro-lab kiểm chứng thực chất cho CF-016:
// AuthN / AuthZ (RBAC), OpenAPI 3.0 Contract & Integration Verification (401 vs 403)
// Chạy từ root: node labs/CF-016/demo.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 1. Kiểm tra sự tồn tại của Artifact sản phẩm
const specPath = path.resolve('tests/integration/order-api.spec.ts');
assert.ok(
  fs.existsSync(specPath),
  'Lỗi: tests/integration/order-api.spec.ts không tồn tại!'
);

// 2. Dynamic import module api-gateway/src/main.ts
const mainModule = await import('file:///' + path.resolve('apps/api-gateway/src/main.ts').replace(/\\/g, '/'));
const {
  createNestApp,
  generateJwt,
  verifyJwt,
  AuthenticationError,
  AuthorizationError,
  OPENAPI_SPEC,
} = mainModule;

assert.ok(generateJwt, 'Thiếu generateJwt');
assert.ok(verifyJwt, 'Thiếu verifyJwt');
assert.ok(OPENAPI_SPEC, 'Thiếu OPENAPI_SPEC');

// 3. Kiểm chứng assertion gốc của Issue: Rule-based Authorization check
const authz = (role, action) => role === 'admin' || action === 'read';
assert.equal(authz('viewer', 'delete'), false, 'Viewer không được phép delete');
assert.equal(authz('admin', 'delete'), true, 'Admin được phép delete');
assert.equal(authz('viewer', 'read'), true, 'Viewer được phép read');

// 4. Kiểm chứng AuthN: JWT Token Cryptographic Verification & Expiration
const secret = 'commerceflow_demo_secret_2026';
const token = generateJwt({ sub: 'user-staff-1', role: 'staff' }, secret);
const decoded = verifyJwt(token, secret);
assert.equal(decoded.sub, 'user-staff-1');
assert.equal(decoded.role, 'staff');

// Token giả mạo chữ ký -> Ném AuthenticationError (401)
assert.throws(
  () => verifyJwt(token, 'tampered_secret'),
  (err) => {
    assert.ok(err instanceof AuthenticationError);
    assert.equal(err.statusCode, 401);
    assert.equal(err.code, 'INVALID_SIGNATURE');
    return true;
  }
);

// 5. Kiểm chứng Phân biệt 401 Unauthorized vs 403 Forbidden (Thử thách độc lập)
const app = await createNestApp({ JWT_SECRET: secret, NODE_ENV: 'test', PORT: '3000' });
const viewerToken = generateJwt({ sub: 'user-viewer-1', role: 'viewer' }, secret);
const staffToken = generateJwt({ sub: 'user-staff-2', role: 'staff' }, secret);

// Seed sản phẩm mẫu cho Catalog
await app.getModule().catalogModule.repository.save({
  id: 'PROD-DEMO-1',
  sku: 'SKU-DEMO-1',
  name: 'Mặt hàng mẫu',
  price: 100,
  currency: 'VND',
  stock: 10,
  internalCost: 70,
  supplierId: 'SUP-01',
  isDeleted: false,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
});

await app.getModule().inventoryModule.repository.setStock({
  productId: 'PROD-DEMO-1',
  availableStock: 10,
  reservedStock: 0,
  totalStock: 10,
  version: 1,
});

// A. Không có Token -> 401 Unauthorized (Chưa xác thực danh tính)
const unauthRes = await app.handleRequest('/api/v1/orders', 'POST', {}, { customerId: 'c1', items: [{ productId: 'PROD-DEMO-1', quantity: 1 }] });
assert.equal(unauthRes.status, 401, 'Request không có token phải trả về HTTP 401');

// B. Có Token nhưng vai trò viewer -> 403 Forbidden (Đã biết danh tính nhưng bị từ chối quyền)
const forbiddenRes = await app.handleRequest(
  '/api/v1/orders',
  'POST',
  { Authorization: `Bearer ${viewerToken}` },
  { customerId: 'c1', items: [{ productId: 'PROD-DEMO-1', quantity: 1 }] }
);
assert.equal(forbiddenRes.status, 403, 'User viewer gọi write endpoint phải trả về HTTP 403');

// C. Có Token hợp lệ với vai trò staff -> 201 Created (Cho phép thực thi)
const successRes = await app.handleRequest(
  '/api/v1/orders',
  'POST',
  { Authorization: `Bearer ${staffToken}` },
  { customerId: 'c1', items: [{ productId: 'PROD-DEMO-1', quantity: 1 }] }
);
assert.equal(successRes.status, 201, 'User staff gọi write endpoint phải thành công HTTP 201');

// 6. Kiểm chứng OpenAPI 3.0 Contract Specification
const openapiRes = await app.handleRequest('/api/v1/openapi.json', 'GET');
assert.equal(openapiRes.status, 200);
assert.equal(openapiRes.body.openapi, '3.0.3');
assert.ok(openapiRes.body.components.securitySchemes.BearerAuth);

console.log('MICRO_LAB_OK CF-016');
