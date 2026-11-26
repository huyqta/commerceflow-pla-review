// tests/standalone/order-standalone.test.ts
// Kiểm thử Standalone Order Microservice (PORT 3003), Data Ownership (order_db)
// và tích hợp Transactional Outbox trong môi trường Microservices phân tán.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { OrderHttpServer } from '../../apps/order-service/src/main.ts';
import { InMemoryOrderRepository } from '../../apps/order-service/src/application/ports/order-repository.ts';
import { simulateRequest } from './simulate-request.ts';

describe('Standalone Order Microservice (PORT 3003 & Data Ownership)', () => {
  let orderServer: OrderHttpServer;
  let orderRepo: InMemoryOrderRepository;

  beforeEach(() => {
    orderRepo = new InMemoryOrderRepository();
    orderServer = new OrderHttpServer(
      { port: 3003 },
      orderRepo,
      // Mock inventory client thành công
      {
        reserve: async () => ({ success: true }),
        release: async () => ({ success: true }),
      },
      // Mock payment client thành công
      {
        charge: async () => ({ status: 'SUCCEEDED', transactionId: 'tx-test-123' }),
      }
    );
  });

  it('1. Order Service phản hồi trên cổng riêng (3003) với Header X-Data-Owner = order_db', async () => {
    assert.equal(orderServer.port, 3003);
    const res = await simulateRequest(orderServer.getAppHandler(), {
      method: 'GET',
      url: '/health',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'HEALTHY');
    assert.equal(res.body.service, 'ordering-service');
    assert.equal(res.headers['X-Data-Owner'], 'order_db');
  });

  it('2. Đặt hàng thành công qua Standalone Microservice Endpoint (POST /api/v1/orders)', async () => {
    const handler = orderServer.getAppHandler();
    const res = await simulateRequest(handler, {
      method: 'POST',
      url: '/api/v1/orders',
      body: {
        orderId: 'ORD-STANDALONE-1',
        customerId: 'CUST-001',
        items: [{ productId: 'PROD-A', quantity: 2, unitPrice: 50000 }],
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.orderId, 'ORD-STANDALONE-1');
    assert.equal(res.body.status, 'CONFIRMED');
    assert.equal(res.body.totalAmount, 100000);

    // Kiểm tra Order đã được lưu vào repository độc lập
    const saved = await orderRepo.findById('ORD-STANDALONE-1');
    assert.ok(saved !== null);
    assert.equal(saved.getStatus(), 'CONFIRMED');
  });

  it('3. Tra cứu chi tiết đơn hàng (GET /api/v1/orders/:id)', async () => {
    const handler = orderServer.getAppHandler();
    // Tạo đơn trước
    await simulateRequest(handler, {
      method: 'POST',
      url: '/api/v1/orders',
      body: {
        orderId: 'ORD-DETAIL-99',
        customerId: 'CUST-002',
        items: [{ productId: 'PROD-B', quantity: 1, unitPrice: 200000 }],
      },
    });

    // Gọi chi tiết
    const res = await simulateRequest(handler, {
      method: 'GET',
      url: '/api/v1/orders/ORD-DETAIL-99',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'ORD-DETAIL-99');
    assert.equal(res.body.totalAmount, 200000);
  });

  it('4. Từ chối đơn hàng rỗng sản phẩm (Negative Validation Case)', async () => {
    const handler = orderServer.getAppHandler();
    const res = await simulateRequest(handler, {
      method: 'POST',
      url: '/api/v1/orders',
      body: {
        orderId: 'ORD-INVALID',
        customerId: 'CUST-003',
        items: [],
      },
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.errorCode, 'EMPTY_ORDER_ITEMS');
  });
});
