import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InventoryHttpServer } from '../../apps/inventory-service/src/main.ts';
import { CatalogHttpServer } from '../../apps/catalog-service/src/main.ts';
import { InMemoryInventoryRepository } from '../../apps/inventory-service/src/application/reserve-stock.ts';
import { InMemoryCatalogRepository } from '../../apps/catalog-service/src/catalog.controller.ts';
import { simulateRequest } from './simulate-request.ts';

describe('1. Khởi chạy Dịch vụ Độc lập (Independent Processes & Ports)', () => {
  const catalogServer = new CatalogHttpServer({ port: 3001 });
  const inventoryServer = new InventoryHttpServer({ port: 3002 });

  it('Catalog Service phản hồi trên cổng riêng (3001) với Header X-Data-Owner = catalog_db', async () => {
    assert.equal(catalogServer.port, 3001);
    const res = await simulateRequest(catalogServer.getAppHandler(), {
      method: 'GET',
      url: '/health',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'HEALTHY');
    assert.equal(res.body.service, 'catalog-service');
    assert.equal(res.headers['X-Data-Owner'], 'catalog_db');
  });

  it('Inventory Service phản hồi trên cổng riêng (3002) với Header X-Data-Owner = inventory_db', async () => {
    assert.equal(inventoryServer.port, 3002);
    const res = await simulateRequest(inventoryServer.getAppHandler(), {
      method: 'GET',
      url: '/health',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'HEALTHY');
    assert.equal(res.body.service, 'inventory-service');
    assert.equal(res.headers['X-Data-Owner'], 'inventory_db');
  });

  it('Cổng của Catalog và Inventory phải hoàn toàn khác nhau (Zero Port Conflict)', () => {
    assert.notEqual(catalogServer.port, inventoryServer.port);
    assert.equal(new Set([catalogServer.port, inventoryServer.port]).size, 2);
  });
});

describe('2. Khả năng Chịu lỗi & Độc lập Tác vụ (Fault Isolation & Thử thách độc lập: Tắt Catalog)', () => {
  let inventoryServer: InventoryHttpServer;
  let inventoryRepo: InMemoryInventoryRepository;

  beforeEach(() => {
    // Chỉ khởi tạo Inventory Service, KHÔNG khởi động Catalog Service (Mô phỏng Catalog sập)
    inventoryRepo = new InMemoryInventoryRepository();
    inventoryRepo.setStock({
      productId: 'PROD-X',
      availableStock: 10,
      reservedStock: 0,
      totalStock: 10,
      version: 1,
    });
    inventoryServer = new InventoryHttpServer({ port: 3002 }, inventoryRepo);
  });

  it('Thử thách độc lập: Khi Catalog Service tắt hoàn toàn, Inventory Service vẫn hoạt động độc lập (Fault Isolation)', async () => {
    const handler = inventoryServer.getAppHandler();

    // 1. Kiểm tra tồn kho PROD-X
    const getRes = await simulateRequest(handler, {
      method: 'GET',
      url: '/api/v1/inventory/PROD-X',
    });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.availableStock, 10);

    // 2. Thực hiện giữ hàng (Reserve) đơn hàng ORD-100 đặt 3 món
    const reserveRes = await simulateRequest(handler, {
      method: 'POST',
      url: '/api/v1/inventory/reserve',
      body: {
        orderId: 'ORD-100',
        items: [{ productId: 'PROD-X', quantity: 3 }],
        idempotencyKey: 'idemp-100',
      },
    });
    assert.equal(reserveRes.status, 200);
    assert.equal(reserveRes.body.status, 'RESERVED');

    // 3. Kiểm tra lại tồn kho sau khi reserve: availableStock còn 7, reservedStock là 3
    const updatedRes = await simulateRequest(handler, {
      method: 'GET',
      url: '/api/v1/inventory/PROD-X',
    });
    assert.equal(updatedRes.body.availableStock, 7);
    assert.equal(updatedRes.body.reservedStock, 3);
  });

  it('Inventory Service bồi hoàn (Release) thành công khi Saga hủy đơn mà không phụ thuộc Catalog', async () => {
    const handler = inventoryServer.getAppHandler();

    // 1. Đặt trước 3 món
    await simulateRequest(handler, {
      method: 'POST',
      url: '/api/v1/inventory/reserve',
      body: {
        orderId: 'ORD-100',
        items: [{ productId: 'PROD-X', quantity: 3 }],
      },
    });

    // 2. Giải phóng 3 món đã giữ của ORD-100
    const releaseRes = await simulateRequest(handler, {
      method: 'POST',
      url: '/api/v1/inventory/release',
      body: {
        orderId: 'ORD-100',
        reason: 'PAYMENT_FAILED_SIMULATION',
      },
    });
    assert.equal(releaseRes.status, 200);
    assert.equal(releaseRes.body.status, 'RELEASED');
    assert.equal(releaseRes.body.released, true);

    // 3. Tồn kho hồi phục về 10
    const finalRes = await simulateRequest(handler, {
      method: 'GET',
      url: '/api/v1/inventory/PROD-X',
    });
    assert.equal(finalRes.body.availableStock, 10);
    assert.equal(finalRes.body.reservedStock, 0);
  });
});

describe('3. Loại bỏ Cross-service Database Access & Negative Tests', () => {
  it('Negative Case: Inventory Service từ chối cho phép truy cập trực tiếp schema của Catalog', () => {
    const server = new InventoryHttpServer();
    assert.equal(server.config.allowDirectCatalogAccess, false, 'allowDirectCatalogAccess phải bị khóa (false)');
  });

  it('Negative Case: Catalog Service từ chối cho phép truy cập trực tiếp schema của Inventory', () => {
    const server = new CatalogHttpServer();
    assert.equal(server.config.allowDirectInventoryAccess, false, 'allowDirectInventoryAccess phải bị khóa (false)');
  });

  it('Negative Case: Inventory Service từ chối request reserve khi vượt quá tồn kho khả dụng (409 Conflict)', async () => {
    const repo = new InMemoryInventoryRepository();
    repo.setStock({
      productId: 'PROD-Y',
      availableStock: 2,
      reservedStock: 0,
      totalStock: 2,
      version: 1,
    });
    const server = new InventoryHttpServer({ port: 3002 }, repo);
    const handler = server.getAppHandler();

    const res = await simulateRequest(handler, {
      method: 'POST',
      url: '/api/v1/inventory/reserve',
      body: {
        orderId: 'ORD-OVERFLOW',
        items: [{ productId: 'PROD-Y', quantity: 5 }],
      },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.errorCode, 'OUT_OF_STOCK');
  });

  it('Negative Case: Chống double release (Idempotent Release) khi gọi bồi hoàn lần thứ 2', async () => {
    const repo = new InMemoryInventoryRepository();
    repo.setStock({
      productId: 'PROD-Z',
      availableStock: 5,
      reservedStock: 0,
      totalStock: 5,
      version: 1,
    });
    const server = new InventoryHttpServer({ port: 3002 }, repo);
    const handler = server.getAppHandler();

    // 1. Reserve 2 món
    await simulateRequest(handler, {
      method: 'POST',
      url: '/api/v1/inventory/reserve',
      body: {
        orderId: 'ORD-DOUBLE',
        items: [{ productId: 'PROD-Z', quantity: 2 }],
      },
    });

    // 2. Release lần 1 -> 200 OK, released = true
    const rel1 = await simulateRequest(handler, {
      method: 'POST',
      url: '/api/v1/inventory/release',
      body: {
        orderId: 'ORD-DOUBLE',
        reason: 'CANCEL_1',
      },
    });
    assert.equal(rel1.status, 200);
    assert.equal(rel1.body.released, true);
    assert.equal(rel1.body.status, 'RELEASED');

    // 3. Release lần 2 -> 200 OK với idempotent status ALREADY_RELEASED, released = false (không tăng tồn kho thêm lần 2)
    const rel2 = await simulateRequest(handler, {
      method: 'POST',
      url: '/api/v1/inventory/release',
      body: {
        orderId: 'ORD-DOUBLE',
        reason: 'CANCEL_2',
      },
    });
    assert.equal(rel2.status, 200);
    assert.equal(rel2.body.released, false);
    assert.equal(rel2.body.status, 'ALREADY_RELEASED');

    // 4. Kiểm tra tồn kho vẫn chính xác là 5 (không bị cộng double lên 7)
    const stockRes = await simulateRequest(handler, {
      method: 'GET',
      url: '/api/v1/inventory/PROD-Z',
    });
    assert.equal(stockRes.body.availableStock, 5);
  });
});
