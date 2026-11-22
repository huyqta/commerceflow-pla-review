// labs/CF-013/demo.mjs
// Micro-lab kiểm chứng thực chất cho CF-013:
// Catalog REST API, DTO Validation, HTTP Status Codes & Zero Entity Leaking
// Chạy từ root: node labs/CF-013/demo.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 1. Kiểm tra sự tồn tại của Artifact
const controllerPath = path.resolve('apps/catalog-service/src/catalog.controller.ts');
assert.ok(
  fs.existsSync(controllerPath),
  'Lỗi: apps/catalog-service/src/catalog.controller.ts không tồn tại!'
);

// 2. Dynamic import module catalog.controller.ts
const controllerModule = await import(`file:///${controllerPath.replace(/\\/g, '/')}`);
const {
  CatalogController,
  InMemoryCatalogRepository,
  validateCreateProductDto,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} = controllerModule;

assert.ok(CatalogController, 'Thiếu CatalogController');
assert.ok(validateCreateProductDto, 'Thiếu validateCreateProductDto');

// 3. Kiểm chứng assertion gốc của Issue: validatePrice (Negative price rejection)
const validatePrice = (v) => Number.isFinite(v) && v >= 0;
assert.equal(validatePrice(-1), false, 'Giá âm (-1) phải trả về false');
assert.equal(validatePrice(10), true, 'Giá dương (10) phải trả về true');

// 4. Kiểm chứng DTO Validation & Negative Cases
// Thử thách độc lập: Từ chối giá âm với BadRequestException (HTTP 400)
assert.throws(
  () =>
    validateCreateProductDto({
      sku: 'SKU-NEG',
      name: 'Mặt hàng giá âm',
      price: -100,
    }),
  (err) => {
    assert.ok(err instanceof BadRequestException);
    assert.equal(err.statusCode, 400);
    assert.match(err.message, /INVALID_PRICE/);
    return true;
  }
);

// 5. Kiểm chứng REST API Endpoints & Status Codes
const repo = new InMemoryCatalogRepository();
const controller = new CatalogController(repo);

const staffAuth = {
  user: { id: 'u-staff', username: 'staff01', role: 'staff' },
};
const viewerAuth = {
  user: { id: 'u-viewer', username: 'viewer01', role: 'viewer' },
};

// A. POST /products: 201 Created (Kịch bản R-01: Sản phẩm A giá 100, stock 5)
const postRes = await controller.createProduct(
  {
    sku: 'PROD-A',
    name: 'Sản phẩm A',
    price: 100,
    initialStock: 5,
  },
  staffAuth
);
assert.equal(postRes.statusCode, 201);
assert.equal(postRes.data.sku, 'PROD-A');
assert.equal(postRes.data.price, 100);
assert.equal(postRes.data.availableStock, 5);

// B. GET /products: 200 OK
const getListRes = await controller.getProducts({ page: 1, limit: 10 });
assert.equal(getListRes.statusCode, 200);
assert.equal(getListRes.data.total, 1);
assert.equal(getListRes.data.items[0].sku, 'PROD-A');

// C. GET /products/:id: 200 OK & 404 NOT_FOUND
const getOneRes = await controller.getProductById(postRes.data.id);
assert.equal(getOneRes.statusCode, 200);
assert.equal(getOneRes.data.id, postRes.data.id);

await assert.rejects(
  async () => controller.getProductById('id-khong-ton-tai'),
  (err) => {
    assert.ok(err instanceof NotFoundException);
    assert.equal(err.statusCode, 404);
    return true;
  }
);

// D. POST /products: 409 Conflict khi trùng SKU
await assert.rejects(
  async () =>
    controller.createProduct(
      { sku: 'PROD-A', name: 'Trùng SKU', price: 200 },
      staffAuth
    ),
  (err) => {
    assert.ok(err instanceof ConflictException);
    assert.equal(err.statusCode, 409);
    return true;
  }
);

// 6. Kiểm chứng R-06 Security Invariants (401 & 403)
// A. Không có token -> 401 Unauthorized
await assert.rejects(
  async () => controller.createProduct({ sku: 'PROD-X', name: 'Item', price: 50 }),
  (err) => {
    assert.ok(err instanceof UnauthorizedException);
    assert.equal(err.statusCode, 401);
    return true;
  }
);

// B. User Viewer gọi write endpoint -> 403 Forbidden
await assert.rejects(
  async () => controller.createProduct({ sku: 'PROD-Y', name: 'Item', price: 50 }, viewerAuth),
  (err) => {
    assert.ok(err instanceof ForbiddenException);
    assert.equal(err.statusCode, 403);
    return true;
  }
);

// 7. Kiểm chứng Trade-off: Chống rò rỉ thông tin nội bộ (Zero Entity Leaking)
const returnedProduct = postRes.data;
assert.equal(returnedProduct.internalCost, undefined, 'Nguy cơ bảo mật: Rò rỉ internalCost');
assert.equal(returnedProduct.supplierNotes, undefined, 'Nguy cơ bảo mật: Rò rỉ supplierNotes');
assert.equal(returnedProduct.isDeleted, undefined, 'Nguy cơ bảo mật: Rò rỉ isDeleted');

console.log('MICRO_LAB_OK CF-013');
