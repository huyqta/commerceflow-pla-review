// tests/api/catalog-api.test.ts
// Automated Tests cho Catalog REST API, DTO Validation, Security RBAC (R-06),
// và cơ chế cách ly thực thể nội bộ (Zero Entity Leaking).
// Chạy trực tiếp qua: node --test tests/api/catalog-api.test.ts

import assert from 'node:assert/strict';
import test, { describe, it, beforeEach } from 'node:test';

import {
  CatalogController,
  InMemoryCatalogRepository,
  validateCreateProductDto,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '../../apps/catalog-service/src/catalog.controller.ts';

describe('1. Kiểm thử DTO Validation & Negative Cases (Giá âm, SKU sai format)', () => {
  it('validateCreateProductDto: Hợp lệ với dữ liệu chuẩn', () => {
    const valid = validateCreateProductDto({
      sku: 'PROD-A',
      name: 'Sản phẩm A',
      price: 100,
      currency: 'VND',
      initialStock: 5,
    });

    assert.equal(valid.sku, 'PROD-A');
    assert.equal(valid.name, 'Sản phẩm A');
    assert.equal(valid.price, 100);
    assert.equal(valid.currency, 'VND');
    assert.equal(valid.initialStock, 5);
  });

  it('Thử thách độc lập: Từ chối giá âm (Negative Price) với lỗi 400 Bad Request', () => {
    assert.throws(
      () =>
        validateCreateProductDto({
          sku: 'PROD-NEG',
          name: 'Sản phẩm lỗi giá',
          price: -50,
        }),
      (err) => {
        assert.ok(err instanceof BadRequestException);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /INVALID_PRICE/);
        return true;
      }
    );
  });

  it('Từ chối khi thiếu trường bắt buộc (sku rỗng, name rỗng)', () => {
    assert.throws(
      () => validateCreateProductDto({ name: 'Không có SKU', price: 100 }),
      /sku là bắt buộc/
    );

    assert.throws(
      () => validateCreateProductDto({ sku: 'PROD-1', price: 100 }),
      /name là bắt buộc/
    );
  });

  it('Từ chối initialStock là số âm hoặc số thập phân', () => {
    assert.throws(
      () => validateCreateProductDto({ sku: 'PROD-1', name: 'Item', price: 10, initialStock: -1 }),
      /initialStock không được là số âm/
    );

    assert.throws(
      () => validateCreateProductDto({ sku: 'PROD-1', name: 'Item', price: 10, initialStock: 2.5 }),
      /initialStock phải là số nguyên/
    );
  });
});

describe('2. Kiểm thử Catalog REST API (GET & POST Endpoints)', () => {
  let repo: InMemoryCatalogRepository;
  let controller: CatalogController;

  const staffContext = {
    user: { id: 'u-staff-1', username: 'staff1', role: 'staff' as const },
  };
  const adminContext = {
    user: { id: 'u-admin-1', username: 'admin1', role: 'admin' as const },
  };
  const viewerContext = {
    user: { id: 'u-view-1', username: 'viewer1', role: 'viewer' as const },
  };

  beforeEach(async () => {
    repo = new InMemoryCatalogRepository();
    controller = new CatalogController(repo);

    // Seed sản phẩm mẫu (R-01: Sản phẩm A có stock=5, giá 100)
    await repo.save({
      id: 'prod-seeded-01',
      sku: 'PROD-A',
      name: 'Sản phẩm A',
      description: 'Sản phẩm A mẫu cho R-01',
      price: 100,
      currency: 'VND',
      stock: 5,
      internalCost: 70,
      supplierId: 'SUPPLIER-VN-01',
      supplierNotes: 'Bí mật kinh doanh',
      isDeleted: false,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('GET /products: Trả về 200 OK với danh sách sản phẩm và phân trang', async () => {
    const res = await controller.getProducts({ page: 1, limit: 10 });
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.total, 1);
    assert.equal(res.data.items.length, 1);
    assert.equal(res.data.items[0].sku, 'PROD-A');
    assert.equal(res.data.items[0].price, 100);
    assert.equal(res.data.items[0].availableStock, 5);
  });

  it('GET /products/:id: Trả về 200 OK khi tìm thấy', async () => {
    const res = await controller.getProductById('prod-seeded-01');
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.id, 'prod-seeded-01');
    assert.equal(res.data.name, 'Sản phẩm A');
  });

  it('GET /products/:id: Trả về 404 NOT_FOUND khi mã sản phẩm không tồn tại', async () => {
    await assert.rejects(
      async () => controller.getProductById('prod-non-existent'),
      (err) => {
        assert.ok(err instanceof NotFoundException);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it('POST /products: Tạo sản phẩm thành công với quyền Staff (201 Created)', async () => {
    const res = await controller.createProduct(
      {
        sku: 'PROD-B',
        name: 'Sản phẩm B',
        price: 250,
        currency: 'VND',
        initialStock: 10,
      },
      staffContext
    );

    assert.equal(res.statusCode, 201);
    assert.equal(res.data.sku, 'PROD-B');
    assert.equal(res.data.name, 'Sản phẩm B');
    assert.equal(res.data.price, 250);
    assert.equal(res.data.availableStock, 10);
    assert.ok(res.data.id.startsWith('prod-'));
  });

  it('POST /products: Trả về 409 Conflict khi tạo sản phẩm có SKU trùng lặp', async () => {
    await assert.rejects(
      async () =>
        controller.createProduct(
          {
            sku: 'PROD-A', // SKU đã tồn tại trong seed
            name: 'Sản phẩm A Trùng',
            price: 150,
          },
          staffContext
        ),
      (err) => {
        assert.ok(err instanceof ConflictException);
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /SKU_ALREADY_EXISTS/);
        return true;
      }
    );
  });
});

describe('3. R-06 Security RBAC & Quyền truy cập', () => {
  let controller: CatalogController;

  beforeEach(() => {
    controller = new CatalogController();
  });

  it('Given request không có token: Then 401 Unauthorized khi gọi POST /products', async () => {
    await assert.rejects(
      async () =>
        controller.createProduct({
          sku: 'PROD-ANON',
          name: 'Item',
          price: 100,
        }),
      (err) => {
        assert.ok(err instanceof UnauthorizedException);
        assert.equal(err.statusCode, 401);
        return true;
      }
    );
  });

  it('Given user viewer: When gọi write endpoint POST /products: Then 403 Forbidden', async () => {
    const viewerContext = {
      user: { id: 'u-view', username: 'viewer', role: 'viewer' as const },
    };

    await assert.rejects(
      async () =>
        controller.createProduct(
          {
            sku: 'PROD-FORBIDDEN',
            name: 'Item',
            price: 100,
          },
          viewerContext
        ),
      (err) => {
        assert.ok(err instanceof ForbiddenException);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /FORBIDDEN/);
        return true;
      }
    );
  });
});

describe('4. Trade-off: Chống rò rỉ thực thể nội bộ (Zero Entity Leaking)', () => {
  it('Response DTO tuyệt đối không để lộ các trường nhạy cảm của database entity', async () => {
    const repo = new InMemoryCatalogRepository();
    const controller = new CatalogController(repo);

    await controller.createProduct(
      {
        sku: 'PROD-SECRET',
        name: 'Sản phẩm bảo mật',
        price: 500,
      },
      { user: { id: 'admin-1', username: 'admin', role: 'admin' } }
    );

    const listRes = await controller.getProducts();
    const publicItem = listRes.data.items[0];

    // Xác nhận các trường công khai có mặt
    assert.equal(publicItem.sku, 'PROD-SECRET');
    assert.equal(publicItem.price, 500);

    // Xác nhận các trường nhạy cảm TUYỆT ĐỐI KHÔNG xuất hiện trong Response DTO
    assert.equal((publicItem as any).internalCost, undefined, 'Rò rỉ internalCost!');
    assert.equal((publicItem as any).supplierId, undefined, 'Rò rỉ supplierId!');
    assert.equal((publicItem as any).supplierNotes, undefined, 'Rò rỉ supplierNotes!');
    assert.equal((publicItem as any).isDeleted, undefined, 'Rò rỉ isDeleted!');
    assert.equal((publicItem as any).version, undefined, 'Rò rỉ version!');
  });
});
