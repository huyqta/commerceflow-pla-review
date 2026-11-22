// apps/catalog-service/src/main.ts
// Standalone Catalog Microservice HTTP Server & REST API
// Phục vụ Milestone M4 (Microservices & Distributed Systems - CF-018)
// Chạy độc lập trên cổng riêng (mặc định PORT 3001), tách biệt hoàn toàn database (catalog_db)
// Đáp ứng kịch bản R-01 (Catalog sản phẩm), R-06 (Security RBAC)
// Tương thích Node.js 24 LTS native type-stripping (không dùng parameter properties).

import http from 'node:http';
import {
  CatalogController,
  InMemoryCatalogRepository,
  HttpException,
  validateCreateProductDto,
} from './catalog.controller.ts';
import type { CatalogRepository } from './catalog.controller.ts';

export interface CatalogServiceConfig {
  readonly port: number;
  readonly serviceName: string;
  readonly databaseUrl?: string;
  readonly allowDirectInventoryAccess: boolean; // Phải là false để bảo đảm Database-per-service
}

export function loadCatalogConfig(): CatalogServiceConfig {
  const port = parseInt(process.env.CATALOG_SERVICE_PORT || process.env.PORT || '3001', 10);
  return {
    port: isNaN(port) ? 3001 : port,
    serviceName: 'catalog-service',
    databaseUrl: process.env.CATALOG_DATABASE_URL || 'postgresql://catalog_user:secret@localhost:5432/catalog_db',
    allowDirectInventoryAccess: false, // Invariant: Cấm truy cập trực tiếp schema của Inventory
  };
}

export class CatalogHttpServer {
  private server: http.Server | null = null;
  public readonly port: number;
  public readonly config: CatalogServiceConfig;
  public readonly repository: CatalogRepository;
  public readonly controller: CatalogController;

  constructor(
    config?: Partial<CatalogServiceConfig>,
    customRepo?: CatalogRepository
  ) {
    this.config = {
      ...loadCatalogConfig(),
      ...config,
    };
    this.port = this.config.port;
    this.repository = customRepo || new InMemoryCatalogRepository();
    this.controller = new CatalogController(this.repository);
  }

  public getAppHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
    return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const method = req.method?.toUpperCase();

      const sendJson = (status: number, data: unknown) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'X-Service-Name': this.config.serviceName,
          'X-Data-Owner': 'catalog_db',
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
        // Health check
        if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/v1/products/health')) {
          sendJson(200, {
            status: 'HEALTHY',
            service: this.config.serviceName,
            port: this.port,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // GET /api/v1/products - Danh sách sản phẩm
        if (method === 'GET' && (url.pathname === '/api/v1/products' || url.pathname === '/products')) {
          const limit = parseInt(url.searchParams.get('limit') || '20', 10);
          const offset = parseInt(url.searchParams.get('offset') || '0', 10);
          const category = url.searchParams.get('category') || undefined;

          const result = await this.controller.findAllProducts({ limit, offset, category });
          sendJson(200, result);
          return;
        }

        // GET /api/v1/products/:id - Chi tiết sản phẩm
        const getMatch = url.pathname.match(/^\/(?:api\/v1\/)?products\/([^/]+)$/);
        if (method === 'GET' && getMatch) {
          const productId = getMatch[1];
          const product = await this.controller.findProductById(productId);
          sendJson(200, product);
          return;
        }

        // POST /api/v1/products - Tạo sản phẩm (yêu cầu quyền staff/admin qua header mô phỏng hoặc middleware)
        if (method === 'POST' && (url.pathname === '/api/v1/products' || url.pathname === '/products')) {
          const authRole = (req.headers['x-user-role'] as string) || 'anonymous';
          const body = await readBody();

          const validatedDto = validateCreateProductDto(body);
          const newProduct = await this.controller.createProduct(
            validatedDto,
            authRole === 'anonymous' ? undefined : { userId: 'user-1', role: authRole }
          );
          sendJson(201, newProduct);
          return;
        }

        sendJson(404, {
          statusCode: 404,
          errorCode: 'ROUTE_NOT_FOUND',
          message: `Không tìm thấy endpoint: ${method} ${url.pathname}`,
        });
      } catch (error: any) {
        if (error instanceof HttpException) {
          sendJson(error.statusCode, {
            statusCode: error.statusCode,
            errorCode: error.errorCode,
            message: error.message,
            details: error.details,
          });
          return;
        }

        sendJson(500, {
          statusCode: 500,
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: error?.message || 'Lỗi xử lý nội bộ tại Catalog Service',
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

if (process.argv[1]?.endsWith('apps/catalog-service/src/main.ts')) {
  const service = new CatalogHttpServer();
  service.start().then(port => {
    console.log(`[Catalog Service] Đang chạy độc lập trên port ${port}`);
  }).catch(err => {
    console.error('[Catalog Service] Khởi động thất bại:', err);
    process.exit(1);
  });
}

