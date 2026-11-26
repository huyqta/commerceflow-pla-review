// apps/order-service/src/main.ts
// Standalone Ordering Microservice HTTP Server & REST API
// Phục vụ Giai đoạn 4 Microservices (Microservices & Distributed Systems - CF-018 / CF-022)
// Chạy độc lập trên cổng riêng (mặc định PORT 3003), sở hữu độc quyền database (order_db)
// Tích hợp Transactional Outbox Pattern & Saga Orchestration
// Tương thích Node.js 24 LTS native type-stripping (không dùng parameter properties).

import http from 'node:http';
import { Order } from './domain/order.aggregate.ts';
import type { OrderStatus } from './domain/order.aggregate.ts';
import {
  CreateOrderUseCase,
  GetOrderByIdQueryHandler,
} from './application/use-cases/create-order.ts';
import {
  type OrderRepository,
  InMemoryOrderRepository,
} from './application/ports/order-repository.ts';
import { PostgresOrderRepository } from './infrastructure/postgres-order.repository.ts';
import {
  OrderSagaOrchestrator,
  type InventoryClient,
  type PaymentClient,
} from './application/order-saga.ts';

export interface OrderServiceConfig {
  readonly port: number;
  readonly serviceName: string;
  readonly databaseUrl?: string;
  readonly catalogServiceUrl: string;
  readonly inventoryServiceUrl: string;
  readonly allowDirectDatabaseSharing: boolean; // Phải là false để bảo đảm Database-per-service
}

export function loadOrderConfig(): OrderServiceConfig {
  const port = parseInt(process.env.ORDER_SERVICE_PORT || process.env.PORT || '3003', 10);
  return {
    port: isNaN(port) ? 3003 : port,
    serviceName: 'ordering-service',
    databaseUrl: process.env.ORDER_DATABASE_URL || 'postgresql://order_user:secret@localhost:5432/order_db',
    catalogServiceUrl: process.env.CATALOG_SERVICE_URL || 'http://localhost:3001',
    inventoryServiceUrl: process.env.INVENTORY_SERVICE_URL || 'http://localhost:3002',
    allowDirectDatabaseSharing: false, // Invariant: Cấm truy cập trực tiếp schema của Catalog và Inventory
  };
}

export class OrderHttpServer {
  private server: http.Server | null = null;
  public readonly port: number;
  public readonly config: OrderServiceConfig;
  public readonly repository: OrderRepository;
  public readonly createOrderUseCase: CreateOrderUseCase;
  public readonly getOrderByIdQueryHandler: GetOrderByIdQueryHandler;
  public readonly sagaOrchestrator: OrderSagaOrchestrator;

  constructor(
    config?: Partial<OrderServiceConfig>,
    customRepo?: OrderRepository,
    customInventoryClient?: InventoryClient,
    customPaymentClient?: PaymentClient
  ) {
    this.config = {
      ...loadOrderConfig(),
      ...config,
    };
    this.port = this.config.port;

    if (customRepo) {
      this.repository = customRepo;
    } else if (this.config.databaseUrl && !this.config.databaseUrl.includes('localhost:5432/order_db')) {
      const pgRepo = new PostgresOrderRepository(this.config.databaseUrl);
      pgRepo.initSchema().catch(err => {
        console.warn('[OrderService] Warning auto-init schema:', err?.message || err);
      });
      this.repository = pgRepo;
    } else {
      this.repository = new InMemoryOrderRepository();
    }

    this.createOrderUseCase = new CreateOrderUseCase(this.repository);
    this.getOrderByIdQueryHandler = new GetOrderByIdQueryHandler(this.repository);

    // Clients cho Saga Orchestration
    const inventoryClient: InventoryClient = customInventoryClient || {
      reserve: async (orderId, items) => {
        // Giao tiếp qua HTTP REST với Inventory Microservice độc lập
        try {
          const res = await fetch(`${this.config.inventoryServiceUrl}/api/v1/inventory/reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, items, idempotencyKey: `idemp-${orderId}` }),
          });
          const data = (await res.json()) as any;
          return { success: res.ok && data.status === 'RESERVED', reason: data.reason };
        } catch (err: any) {
          return { success: false, reason: err.message };
        }
      },
      release: async (orderId, reason) => {
        try {
          const res = await fetch(`${this.config.inventoryServiceUrl}/api/v1/inventory/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, reason }),
          });
          return { success: res.ok };
        } catch {
          return { success: false };
        }
      },
    };

    const paymentClient: PaymentClient = customPaymentClient || {
      charge: async (command) => {
        // Mô phỏng thanh toán
        return { status: 'SUCCEEDED', transactionId: `tx-${Date.now()}` };
      },
    };

    this.sagaOrchestrator = new OrderSagaOrchestrator(inventoryClient, paymentClient);
  }

  public getAppHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
    return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const method = req.method?.toUpperCase();

      const sendJson = (status: number, data: unknown) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'X-Service-Name': this.config.serviceName,
          'X-Data-Owner': 'order_db',
        });
        res.end(JSON.stringify(data));
      };

      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID',
        });
        res.end();
        return;
      }

      const readBody = async (): Promise<any> => {
        return new Promise((resolve, reject) => {
          let body = '';
          req.on('data', chunk => {
            body += chunk;
          });
          req.on('end', () => {
            if (!body) return resolve({});
            try {
              resolve(JSON.parse(body));
            } catch (err) {
              reject(err);
            }
          });
          req.on('error', reject);
        });
      };

      try {
        // Health check endpoint
        if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/v1/orders/health')) {
          sendJson(200, {
            status: 'HEALTHY',
            service: this.config.serviceName,
            dataOwner: 'order_db',
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // POST /api/v1/orders: Tạo đơn hàng độc lập (Microservice Endpoint)
        if (method === 'POST' && (url.pathname === '/api/v1/orders' || url.pathname === '/api/orders')) {
          const body = await readBody();
          const customerId = body.customerId || 'cust-default';
          const items = body.items || [];

          if (!Array.isArray(items) || items.length === 0) {
            sendJson(400, {
              statusCode: 400,
              errorCode: 'EMPTY_ORDER_ITEMS',
              message: 'Đơn hàng bắt buộc phải có ít nhất một sản phẩm',
            });
            return;
          }

          const orderId = body.orderId || `ord-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const normalizedItems = items.map((it: any) => ({
            productId: it.productId || it.sku || it.id,
            quantity: Number(it.quantity) || 1,
            unitPrice: Number(it.unitPrice || it.price || 100000),
            currency: it.currency || 'VND',
          }));

          // Khởi tạo Order Aggregate Root (Invariants & Domain Events)
          const order = Order.create(orderId, customerId, normalizedItems);

          // Khởi chạy Saga điều phối phân tán
          const sagaState = await this.sagaOrchestrator.startSaga({
            orderId: order.id,
            customerId: order.customerId,
            items: normalizedItems.map(it => ({ productId: it.productId, quantity: it.quantity })),
            totalAmount: order.getTotalAmount(),
            currency: 'VND',
          });

          if (sagaState.orderStatus === 'CONFIRMED') {
            order.confirm();
          } else if (sagaState.orderStatus === 'REJECTED') {
            order.reject(sagaState.lastError || 'Out of stock');
          } else if (sagaState.orderStatus === 'CANCELLED') {
            order.cancel(sagaState.lastError || 'Payment failed');
          }

          // Lưu Order và tự động ghi Outbox Event trong cùng transaction
          await this.repository.save(order);

          sendJson(201, {
            statusCode: 201,
            orderId: order.id,
            status: order.getStatus(),
            totalAmount: order.getTotalAmount(),
            items: order.getItems().map(it => ({
              productId: it.productId,
              quantity: it.quantity.value,
              unitPrice: it.unitPrice.amount,
            })),
            sagaStep: sagaState.currentStep,
            createdAt: order.createdAt,
          });
          return;
        }

        // GET /api/v1/orders/:id: Chi tiết đơn hàng
        const detailMatch = url.pathname.match(/^\/api(?:\/v1)?\/orders\/([^/]+)$/);
        if (method === 'GET' && detailMatch) {
          const orderId = detailMatch[1];
          const order = await this.repository.findById(orderId);
          if (!order) {
            sendJson(404, {
              statusCode: 404,
              errorCode: 'ORDER_NOT_FOUND',
              message: `Không tìm thấy đơn hàng với ID '${orderId}'`,
            });
            return;
          }

          sendJson(200, {
            id: order.id,
            customerId: order.customerId,
            status: order.getStatus(),
            totalAmount: order.getTotalAmount(),
            items: order.getItems().map(it => ({
              productId: it.productId,
              quantity: it.quantity.value,
              unitPrice: it.unitPrice.amount,
              subtotal: it.getSubtotal(),
            })),
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
          });
          return;
        }

        // GET /api/v1/orders: Danh sách đơn hàng
        if (method === 'GET' && (url.pathname === '/api/v1/orders' || url.pathname === '/api/orders')) {
          const customerId = url.searchParams.get('customerId');
          let orders: Order[] = [];
          if (customerId) {
            orders = await this.repository.findByCustomerId(customerId);
          } else if (typeof (this.repository as any).findAll === 'function') {
            orders = await (this.repository as any).findAll();
          }

          const serialized = orders.map(o => ({
            id: o.id,
            customerId: o.customerId,
            status: o.getStatus(),
            totalAmount: o.getTotalAmount(),
            itemCount: o.getItems().length,
            createdAt: o.createdAt,
          }));

          sendJson(200, serialized);
          return;
        }

        sendJson(404, { statusCode: 404, message: 'Endpoint not found' });
      } catch (err: any) {
        sendJson(500, {
          statusCode: 500,
          errorCode: err.code || 'INTERNAL_SERVER_ERROR',
          message: err.message,
        });
      }
    };
  }

  public async start(): Promise<void> {
    const handler = this.getAppHandler();
    this.server = http.createServer((req, res) => {
      handler(req, res).catch(err => {
        console.error('[OrderService] Uncaught request error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }));
        }
      });
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, () => {
        console.log(`[OrderService] Standalone Order Microservice listening on port ${this.port} (Data Owner: order_db)`);
        resolve();
      });
    });
  }

  public async close(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
    if (typeof (this.repository as any).close === 'function') {
      await (this.repository as any).close();
    }
  }
}

// Chạy trực tiếp nếu execute từ command line
if (process.argv[1]?.endsWith('apps/order-service/src/main.ts')) {
  const service = new OrderHttpServer();
  service.start().then(() => {
    console.log(`[Order Service] Đang chạy độc lập trên port ${service.port}`);
  }).catch(err => {
    console.error('[Order Service] Khởi động thất bại:', err);
    process.exit(1);
  });
}

