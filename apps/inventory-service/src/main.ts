// apps/inventory-service/src/main.ts
// Standalone Inventory Microservice HTTP Server & REST API
// Phục vụ Milestone M4 (Microservices & Distributed Systems - CF-018)
// Chạy độc lập trên cổng riêng (mặc định PORT 3002), tách biệt hoàn toàn database (inventory_db)
// Đáp ứng kịch bản R-01 (Giữ hàng), R-02 (Hết hàng), R-03 (Hoàn kho), R-04 (Chống trùng lặp Idempotency)
// Tương thích Node.js 24 LTS native type-stripping (không dùng parameter properties).

import http from 'node:http';
import {
  ReserveStockUseCase,
  ReleaseStockUseCase,
  InMemoryInventoryRepository,
  OutOfStockError,
  InvalidQuantityError,
} from './application/reserve-stock.ts';
import type {
  InventoryRepository,
  ReserveStockCommand,
  ReleaseStockCommand,
} from './application/reserve-stock.ts';

export interface InventoryServiceConfig {
  readonly port: number;
  readonly serviceName: string;
  readonly databaseUrl?: string;
  readonly allowDirectCatalogAccess: boolean; // Phải là false để bảo đảm Database-per-service
}

export function loadInventoryConfig(): InventoryServiceConfig {
  const port = parseInt(process.env.INVENTORY_SERVICE_PORT || process.env.PORT || '3002', 10);
  return {
    port: isNaN(port) ? 3002 : port,
    serviceName: 'inventory-service',
    databaseUrl: process.env.INVENTORY_DATABASE_URL || 'postgresql://inventory_user:secret@localhost:5432/inventory_db',
    allowDirectCatalogAccess: false, // Invariant: Cấm truy cập trực tiếp schema của Catalog
  };
}

export class InventoryHttpServer {
  private server: http.Server | null = null;
  public readonly port: number;
  public readonly config: InventoryServiceConfig;
  public readonly repository: InventoryRepository;
  public readonly reserveStockUseCase: ReserveStockUseCase;
  public readonly releaseStockUseCase: ReleaseStockUseCase;

  constructor(
    config?: Partial<InventoryServiceConfig>,
    customRepo?: InventoryRepository
  ) {
    this.config = {
      ...loadInventoryConfig(),
      ...config,
    };
    this.port = this.config.port;
    this.repository = customRepo || new InMemoryInventoryRepository();
    this.reserveStockUseCase = new ReserveStockUseCase(this.repository);
    this.releaseStockUseCase = new ReleaseStockUseCase(this.repository);
  }

  public getAppHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
    return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const method = req.method?.toUpperCase();

      const sendJson = (status: number, data: unknown) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'X-Service-Name': this.config.serviceName,
          'X-Data-Owner': 'inventory_db',
        });
        res.end(JSON.stringify(data));
      };

      // CORS Preflight
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID',
        });
        res.end();
        return;
      }

      // Read Body helper
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
        if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/v1/inventory/health')) {
          sendJson(200, {
            status: 'HEALTHY',
            service: this.config.serviceName,
            port: this.port,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // GET /api/v1/inventory/:productId - Lấy tồn kho khả dụng
        const getMatch = url.pathname.match(/^\/api\/v1\/inventory\/([^/]+)$/);
        if (method === 'GET' && getMatch) {
          const productId = getMatch[1];
          const stock = await this.repository.getStock(productId);
          if (!stock) {
            sendJson(404, {
              statusCode: 404,
              errorCode: 'STOCK_ITEM_NOT_FOUND',
              message: `Không tìm thấy thông tin tồn kho cho sản phẩm '${productId}'`,
            });
            return;
          }
          sendJson(200, {
            productId: stock.productId,
            availableStock: stock.availableStock,
            reservedStock: stock.reservedStock,
            totalStock: stock.totalStock,
            version: stock.version,
          });
          return;
        }

        // POST /api/v1/inventory/reserve - Giữ tồn kho nguyên tử (Kịch bản R-01, R-02, R-04, R-07)
        if (method === 'POST' && url.pathname === '/api/v1/inventory/reserve') {
          const body = await readBody();
          if (!body.orderId || !Array.isArray(body.items) || body.items.length === 0) {
            sendJson(400, {
              statusCode: 400,
              errorCode: 'BAD_REQUEST',
              message: 'Dữ liệu không hợp lệ: Yêu cầu cung cấp orderId và mảng items',
            });
            return;
          }

          const command: ReserveStockCommand = {
            orderId: body.orderId,
            items: body.items,
            idempotencyKey: body.idempotencyKey || `reserve-${body.orderId}`,
          };

          const result = await this.reserveStockUseCase.execute(command);
          if (!result.success) {
            sendJson(409, {
              statusCode: 409,
              errorCode: 'OUT_OF_STOCK',
              message: `Hết hàng cho sản phẩm: ${result.failedProductId || 'UNKNOWN'}`,
              productId: result.failedProductId,
              reason: result.reason,
            });
            return;
          }

          sendJson(200, {
            reservationId: result.reservationId,
            orderId: result.orderId,
            status: 'RESERVED',
            items: result.items,
          });
          return;
        }

        // POST /api/v1/inventory/release - Giải phóng tồn kho bồi hoàn (Kịch bản R-03 Saga Compensation)
        if (method === 'POST' && url.pathname === '/api/v1/inventory/release') {
          const body = await readBody();
          if (!body.orderId || !body.reason) {
            sendJson(400, {
              statusCode: 400,
              errorCode: 'BAD_REQUEST',
              message: 'Dữ liệu không hợp lệ: Yêu cầu cung cấp orderId và reason',
            });
            return;
          }

          const command: ReleaseStockCommand = {
            orderId: body.orderId,
            reason: body.reason,
            idempotencyKey: body.idempotencyKey || `release-${body.orderId}`,
          };

          const result = await this.releaseStockUseCase.execute(command);
          if (!result.success && result.reason === 'RESERVATION_NOT_FOUND') {
            sendJson(404, {
              statusCode: 404,
              errorCode: 'RESERVATION_NOT_FOUND',
              message: 'Không tìm thấy thông tin reservation để bồi hoàn',
            });
            return;
          }

          sendJson(200, {
            reservationId: result.reservationId,
            released: result.released,
            reason: result.reason,
            status: result.released ? 'RELEASED' : 'ALREADY_RELEASED',
          });
          return;
        }

        // 404 Route Not Found
        sendJson(404, {
          statusCode: 404,
          errorCode: 'ROUTE_NOT_FOUND',
          message: `Không tìm thấy endpoint: ${method} ${url.pathname}`,
        });
      } catch (error: any) {
        if (error instanceof OutOfStockError) {
          sendJson(409, {
            statusCode: 409,
            errorCode: error.code,
            message: error.message,
            productId: error.productId,
            requested: error.requested,
            available: error.available,
          });
          return;
        }

        if (error instanceof InvalidQuantityError) {
          sendJson(400, {
            statusCode: 400,
            errorCode: error.code,
            message: error.message,
          });
          return;
        }

        sendJson(500, {
          statusCode: 500,
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: error?.message || 'Lỗi xử lý nội bộ tại Inventory Service',
        });
      }
    };
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.getAppHandler());
      this.server.listen(this.port, () => {
        resolve(this.port);
      });
      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close(err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

// Chạy trực tiếp nếu execute từ command line
if (process.argv[1]?.endsWith('apps/inventory-service/src/main.ts')) {
  const service = new InventoryHttpServer();
  service.start().then(port => {
    console.log(`[Inventory Service] Đang chạy độc lập trên port ${port}`);
  }).catch(err => {
    console.error('[Inventory Service] Khởi động thất bại:', err);
    process.exit(1);
  });
}
