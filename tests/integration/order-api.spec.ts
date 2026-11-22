// tests/integration/order-api.spec.ts
// Integration Tests cho Order API, Route Authorization (RBAC), Input Validation,
// 401 Unauthorized, 403 Forbidden và OpenAPI Contract (CommerceFlow R-06 & Milestone M3).
// Chạy trực tiếp qua: node --test tests/integration/order-api.spec.ts

import assert from 'node:assert/strict';
import test, { describe, it, beforeEach } from 'node:test';

import {
  createNestApp,
  generateJwt,
  verifyJwt,
  NestApplication,
  AuthenticationError,
  AuthorizationError,
  OPENAPI_SPEC,
} from '../../apps/api-gateway/src/main.ts';

describe('1. Authentication (AuthN) & Cryptographic JWT Token Verification', () => {
  const secret = 'commerceflow_test_jwt_secret_key_12345';

  it('Tạo và giải mã JWT token hợp lệ với đầy đủ claims (sub, role, username)', () => {
    const token = generateJwt({ sub: 'user-001', role: 'staff', username: 'john_staff' }, secret);
    assert.ok(typeof token === 'string' && token.split('.').length === 3);

    const decoded = verifyJwt(token, secret);
    assert.equal(decoded.sub, 'user-001');
    assert.equal(decoded.role, 'staff');
    assert.equal(decoded.username, 'john_staff');
    assert.ok(decoded.exp! > Math.floor(Date.now() / 1000));
  });

  it('Từ chối token có chữ ký giả mạo hoặc secret sai (401 Unauthorized)', () => {
    const validToken = generateJwt({ sub: 'user-002', role: 'admin' }, secret);

    // Xác thực bằng secret sai
    assert.throws(
      () => verifyJwt(validToken, 'wrong_secret_key'),
      (err) => {
        assert.ok(err instanceof AuthenticationError);
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, 'INVALID_SIGNATURE');
        return true;
      }
    );
  });

  it('Từ chối token đã hết hạn (TOKEN_EXPIRED - 401 Unauthorized)', () => {
    // Tạo token đã hết hạn 10 giây trước
    const expiredToken = generateJwt(
      { sub: 'user-003', role: 'viewer', exp: Math.floor(Date.now() / 1000) - 10 },
      secret
    );

    assert.throws(
      () => verifyJwt(expiredToken, secret),
      (err) => {
        assert.ok(err instanceof AuthenticationError);
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, 'TOKEN_EXPIRED');
        return true;
      }
    );
  });

  it('Từ chối token cấu trúc sai định dạng (MALFORMED_TOKEN)', () => {
    assert.throws(
      () => verifyJwt('invalid.token', secret),
      (err) => {
        assert.ok(err instanceof AuthenticationError);
        assert.equal(err.code, 'MALFORMED_TOKEN');
        return true;
      }
    );
  });
});

describe('2. Route Authorization & Security Invariants (Kịch bản R-06)', () => {
  let app: NestApplication;
  const secret = 'commerceflow_test_jwt_secret_key_12345';

  let adminToken: string;
  let staffToken: string;
  let viewerToken: string;

  beforeEach(async () => {
    app = await createNestApp({
      JWT_SECRET: secret,
      NODE_ENV: 'test',
      PORT: '3000',
    });

    // Seed sản phẩm mẫu vào Catalog và Inventory
    await app.getModule().catalogModule.repository.save({
      id: 'PROD-A',
      sku: 'SKU-A',
      name: 'Sản phẩm A',
      price: 100,
      currency: 'VND',
      stock: 5,
      internalCost: 70,
      supplierId: 'SUPPLIER-01',
      isDeleted: false,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await app.getModule().inventoryModule.repository.setStock({
      productId: 'PROD-A',
      availableStock: 5,
      reservedStock: 0,
      totalStock: 5,
      version: 1,
    });

    adminToken = generateJwt({ sub: 'u-admin', role: 'admin' }, secret);
    staffToken = generateJwt({ sub: 'u-staff', role: 'staff' }, secret);
    viewerToken = generateJwt({ sub: 'u-viewer', role: 'viewer' }, secret);
  });

  it('Given request không có token: When gọi POST /api/v1/orders -> Then 401 Unauthorized', async () => {
    const res = await app.handleRequest('/api/v1/orders', 'POST', {}, {
      customerId: 'cust-1',
      items: [{ productId: 'PROD-A', quantity: 1 }],
    });

    assert.equal(res.status, 401);
    assert.match((res.body as any).message, /UNAUTHORIZED/);
  });

  it('Given request không có token: When gọi POST /api/v1/products -> Then 401 Unauthorized', async () => {
    const res = await app.handleRequest('/api/v1/products', 'POST', {}, {
      sku: 'SKU-NEW',
      name: 'Món mới',
      price: 150,
    });

    assert.equal(res.status, 401);
    assert.match((res.body as any).message, /UNAUTHORIZED/);
  });

  it('Given user viewer: When gọi write endpoint POST /api/v1/orders -> Then 403 Forbidden', async () => {
    const res = await app.handleRequest(
      '/api/v1/orders',
      'POST',
      { Authorization: `Bearer ${viewerToken}` },
      {
        customerId: 'cust-viewer',
        items: [{ productId: 'PROD-A', quantity: 1 }],
      }
    );

    assert.equal(res.status, 403);
    assert.match((res.body as any).message, /FORBIDDEN/);
    assert.match((res.body as any).message, /viewer/);
  });

  it('Given user viewer: When gọi write endpoint POST /api/v1/products -> Then 403 Forbidden', async () => {
    const res = await app.handleRequest(
      '/api/v1/products',
      'POST',
      { Authorization: `Bearer ${viewerToken}` },
      {
        sku: 'SKU-FORBIDDEN',
        name: 'Món cấm',
        price: 200,
      }
    );

    assert.equal(res.status, 403);
    assert.match((res.body as any).message, /FORBIDDEN/);
  });

  it('Given user staff hoặc admin: When gọi POST /api/v1/orders -> Cho phép thực thi thành công (201 Created)', async () => {
    const staffRes = await app.handleRequest(
      '/api/v1/orders',
      'POST',
      { Authorization: `Bearer ${staffToken}` },
      {
        orderId: 'ord-staff-success',
        customerId: 'cust-staff',
        items: [{ productId: 'PROD-A', quantity: 1 }],
      }
    );

    assert.equal(staffRes.status, 201);
    assert.equal((staffRes.body as any).status, 'CONFIRMED');

    const adminRes = await app.handleRequest(
      '/api/v1/orders',
      'POST',
      { Authorization: `Bearer ${adminToken}` },
      {
        orderId: 'ord-admin-success',
        customerId: 'cust-admin',
        items: [{ productId: 'PROD-A', quantity: 1 }],
      }
    );

    assert.equal(adminRes.status, 201);
    assert.equal((adminRes.body as any).status, 'CONFIRMED');
  });

  it('Given user viewer: Được phép gọi read endpoint GET /api/v1/orders/:id và GET /api/v1/products (200 OK)', async () => {
    // 1. Xem danh sách sản phẩm
    const listRes = await app.handleRequest('/api/v1/products', 'GET');
    assert.equal(listRes.status, 200);

    // 2. Tạo đơn trước đó bởi staff
    await app.handleRequest(
      '/api/v1/orders',
      'POST',
      { Authorization: `Bearer ${staffToken}` },
      {
        orderId: 'ord-view-test',
        customerId: 'cust-view-test',
        items: [{ productId: 'PROD-A', quantity: 1 }],
      }
    );

    // 3. Viewer xem chi tiết đơn hàng
    const orderRes = await app.handleRequest(
      '/api/v1/orders/ord-view-test',
      'GET',
      { Authorization: `Bearer ${viewerToken}` }
    );
    assert.equal(orderRes.status, 200);
    assert.equal((orderRes.body as any).id, 'ord-view-test');
  });
});

describe('3. Input Validation & Status Codes (400 Bad Request)', () => {
  let app: NestApplication;
  let staffToken: string;

  beforeEach(async () => {
    app = await createNestApp();
    staffToken = generateJwt({ sub: 'staff-1', role: 'staff' }, app.getModule().config.jwtSecret);
  });

  it('Từ chối request rỗng hoặc thiếu danh sách items (400 Bad Request)', async () => {
    const res = await app.handleRequest(
      '/api/v1/orders',
      'POST',
      { Authorization: `Bearer ${staffToken}` },
      { customerId: 'c1' } // Thiếu items
    );

    assert.equal(res.status, 400);
    assert.match((res.body as any).message, /BAD_REQUEST/);
  });
});

describe('4. OpenAPI 3.0 Documentation Contract', () => {
  let app: NestApplication;

  beforeEach(async () => {
    app = await createNestApp();
  });

  it('GET /api/v1/openapi.json: Trả về tài liệu OpenAPI 3.0 đầy đủ các paths và security scheme', async () => {
    const res = await app.handleRequest('/api/v1/openapi.json', 'GET');

    assert.equal(res.status, 200);
    const spec = res.body as any;
    assert.equal(spec.openapi, '3.0.3');
    assert.ok(spec.paths['/api/v1/orders']);
    assert.ok(spec.paths['/api/v1/products']);
    assert.ok(spec.components.securitySchemes.BearerAuth);
    assert.equal(spec.components.securitySchemes.BearerAuth.scheme, 'bearer');
  });
});

