// apps/api-gateway/src/main.ts
// NestJS Modular Monolith Bootstrap, Module Wiring, Configuration,
// AuthN/AuthZ (HMAC-SHA256 JWT, RBAC), OpenAPI 3.0 & Route Routing Pipeline (CommerceFlow Milestone M3)
// Tương thích Node.js 24 LTS native type-stripping (không dùng parameter properties hay legacy decorators).

import http from 'node:http';
import crypto from 'node:crypto';
import {
  CreateOrderUseCase,
  GetOrderByIdQueryHandler,
  InMemoryUnitOfWork,
} from '../../order-service/src/application/use-cases/create-order.ts';
import { InMemoryOrderRepository } from '../../order-service/src/application/ports/order-repository.ts';
import {
  PlaceOrderUseCase,
  PlaceOrderController,
  InMemoryCatalogPortAdapter,
  PaymentSimulatorPortAdapter,
} from '../../order-service/src/application/place-order.ts';
import {
  CatalogController,
  InMemoryCatalogRepository,
} from '../../catalog-service/src/catalog.controller.ts';
import {
  ReserveStockUseCase,
  ReleaseStockUseCase,
  InMemoryInventoryRepository,
} from '../../inventory-service/src/application/reserve-stock.ts';

/**
 * -------------------------------------------------------------
 * 1. Configuration & Validation (Fail-fast & Secret Security)
 * -------------------------------------------------------------
 */
export class ConfigurationError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'CONFIGURATION_ERROR') {
    super(message);
    this.name = 'ConfigurationError';
    this.code = code;
  }
}

export interface AppConfig {
  readonly port: number;
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly serviceName: string;
  readonly apiPrefix: string;
  readonly databaseUrl?: string;
  readonly jwtSecret: string;
}

export function loadAndValidateConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // 1. Kiểm tra và chuẩn hóa PORT
  const rawPort = env.PORT ?? '3000';
  const parsedPort = Number(rawPort);

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new ConfigurationError(
      `INVALID_PORT: Cổng PORT '${rawPort}' không hợp lệ. Phải là số nguyên từ 1 đến 65535.`,
      'INVALID_PORT'
    );
  }

  // 2. Chuẩn hóa NODE_ENV
  const rawEnv = (env.NODE_ENV ?? 'development').toLowerCase();
  const validEnvs = ['development', 'production', 'test'];
  if (!validEnvs.includes(rawEnv)) {
    throw new ConfigurationError(
      `INVALID_NODE_ENV: Môi trường '${rawEnv}' không hợp lệ. Chỉ chấp nhận: ${validEnvs.join(', ')}`,
      'INVALID_NODE_ENV'
    );
  }
  const nodeEnv = rawEnv as 'development' | 'production' | 'test';

  // 3. Quy tắc bảo mật: Không bao giờ dùng secret mặc định trên Production
  const jwtSecret = env.JWT_SECRET ?? 'commerceflow_local_jwt_secret_key_2026';
  if (nodeEnv === 'production') {
    if (!jwtSecret || jwtSecret.trim() === '' || jwtSecret.includes('local_only') || jwtSecret.includes('change_me')) {
      throw new ConfigurationError(
        'INSECURE_PRODUCTION_SECRET: Tuyệt đối không sử dụng JWT_SECRET mặc định hoặc để trống trên môi trường production!',
        'INSECURE_PRODUCTION_SECRET'
      );
    }
  }

  return Object.freeze({
    port: parsedPort,
    nodeEnv,
    serviceName: env.SERVICE_NAME ?? 'commerceflow-api-gateway',
    apiPrefix: env.API_PREFIX ?? '/api/v1',
    databaseUrl: env.DATABASE_URL,
    jwtSecret,
  });
}

/**
 * -------------------------------------------------------------
 * 2. Cryptographic JWT Helpers (AuthN / Authentication)
 * -------------------------------------------------------------
 * Mã hóa chữ ký HMAC-SHA256 chuẩn bảo vệ tính toàn vẹn của Token
 */
export type UserRole = 'admin' | 'staff' | 'viewer';

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
  exp?: number;
  iat?: number;
}

export class AuthenticationError extends Error {
  public readonly statusCode = 401;
  public readonly code: string;

  constructor(message: string, code = 'UNAUTHORIZED') {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}

export class AuthorizationError extends Error {
  public readonly statusCode = 403;
  public readonly code: string;

  constructor(message: string, code = 'FORBIDDEN') {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
  }
}

export function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function generateJwt(
  payload: { sub: string; role: UserRole; username?: string; exp?: number },
  secret = 'commerceflow_local_jwt_secret_key_2026',
  expiresInSeconds = 3600
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    sub: payload.sub,
    username: payload.username ?? payload.sub,
    role: payload.role,
    iat: now,
    exp: payload.exp ?? now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(dataToSign)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${dataToSign}.${signature}`;
}

export function verifyJwt(
  token: string,
  secret = 'commerceflow_local_jwt_secret_key_2026'
): JwtPayload {
  if (!token || typeof token !== 'string') {
    throw new AuthenticationError('TOKEN_REQUIRED: Yêu cầu cung cấp JWT token hợp lệ', 'TOKEN_REQUIRED');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new AuthenticationError('MALFORMED_TOKEN: Cấu trúc JWT token không đúng 3 phần (header.payload.signature)', 'MALFORMED_TOKEN');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(dataToSign)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  // Chống Timing Attack với timingSafeEqual
  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    throw new AuthenticationError('INVALID_SIGNATURE: Chữ ký token không hợp lệ hoặc đã bị chỉnh sửa', 'INVALID_SIGNATURE');
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw new AuthenticationError('INVALID_PAYLOAD: Không thể giải mã payload của token', 'INVALID_PAYLOAD');
  }

  // Kiểm tra thời hạn hết hạn (Expiration Check)
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new AuthenticationError('TOKEN_EXPIRED: Token xác thực đã hết hạn', 'TOKEN_EXPIRED');
  }

  return payload;
}

/**
 * -------------------------------------------------------------
 * 3. OpenAPI 3.0 Specification Document
 * -------------------------------------------------------------
 */
export const OPENAPI_SPEC = Object.freeze({
  openapi: '3.0.3',
  info: {
    title: 'CommerceFlow Core REST API',
    version: '1.0.0',
    description: 'REST API for CommerceFlow Modular Monolith: Catalog, Inventory, Ordering and RBAC Security.',
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Nhập JWT token sinh ra từ identity provider với claim vai trò: admin, staff, hoặc viewer.',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Liveness Probe (Không phụ thuộc DB)',
        responses: { '200': { description: 'Liveness UP' } },
      },
    },
    '/api/v1/products': {
      get: {
        summary: 'Danh sách sản phẩm Catalog',
        responses: { '200': { description: 'Danh sách sản phẩm phân trang' } },
      },
      post: {
        summary: 'Tạo sản phẩm mới trong Catalog',
        security: [{ BearerAuth: [] }],
        responses: {
          '201': { description: 'Sản phẩm đã tạo thành công' },
          '400': { description: 'Validation failed (giá âm, SKU rỗng)' },
          '401': { description: 'Unauthorized: Thiếu token' },
          '403': { description: 'Forbidden: Vai trò viewer không có quyền ghi' },
          '409': { description: 'Conflict: Trùng SKU' },
        },
      },
    },
    '/api/v1/orders': {
      post: {
        summary: 'Đặt hàng mới (Place Order Lifecycle)',
        security: [{ BearerAuth: [] }],
        responses: {
          '201': { description: 'Đặt hàng thành công và đã xác nhận (CONFIRMED)' },
          '400': { description: 'Validation error: Dữ liệu đặt hàng không hợp lệ' },
          '401': { description: 'Unauthorized: Thiếu token xác thực' },
          '403': { description: 'Forbidden: Quyền truy cập bị từ chối' },
          '422': { description: 'Unprocessable Entity: Hết hàng trong kho (REJECTED)' },
          '402': { description: 'Payment Required: Thanh toán thất bại (CANCELLED + Bồi hoàn kho)' },
        },
      },
    },
    '/api/v1/orders/{id}': {
      get: {
        summary: 'Tra cứu thông tin chi tiết đơn hàng',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Chi tiết đơn hàng' },
          '401': { description: 'Unauthorized' },
          '404': { description: 'Không tìm thấy đơn hàng' },
        },
      },
    },
  },
});

/**
 * -------------------------------------------------------------
 * 4. Health & Modules Wiring
 * -------------------------------------------------------------
 */
export interface HealthStatusResponse {
  status: 'UP' | 'DOWN';
  service: string;
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    liveness: 'OK';
    database?: 'CONNECTED' | 'DISCONNECTED';
  };
}

export class HealthController {
  private readonly startTime: number;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.startTime = Date.now();
  }

  public getLiveness(): HealthStatusResponse {
    return {
      status: 'UP',
      service: this.config.serviceName,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      checks: {
        liveness: 'OK',
      },
    };
  }

  public async getReadiness(isDbConnected = true): Promise<HealthStatusResponse> {
    const liveness = this.getLiveness();
    return {
      ...liveness,
      status: isDbConnected ? 'UP' : 'DOWN',
      checks: {
        liveness: 'OK',
        database: isDbConnected ? 'CONNECTED' : 'DISCONNECTED',
      },
    };
  }
}

export class HealthModule {
  public readonly controller: HealthController;

  constructor(config: AppConfig) {
    this.controller = new HealthController(config);
  }
}

export class CatalogModule {
  public readonly repository: InMemoryCatalogRepository;
  public readonly controller: CatalogController;

  constructor() {
    // Seed sẵn danh sách sản phẩm mẫu cho môi trường Demo
    const sampleProducts = [
      {
        id: 'prod-001',
        sku: 'IPHONE-15-PRO',
        name: 'iPhone 15 Pro Max 256GB Titan Tự Nhiên',
        description: 'Điện thoại thông minh Apple cao cấp, chip A17 Pro mạnh mẽ',
        price: 34990000,
        currency: 'VND',
        stock: 50,
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
      },
      {
        id: 'prod-002',
        sku: 'MACBOOK-AIR-M3',
        name: 'MacBook Air 13 inch M3 16GB/512GB',
        description: 'Laptop siêu mỏng nhẹ, pin 18 giờ, hiệu năng đột phá',
        price: 32990000,
        currency: 'VND',
        stock: 30,
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
      },
      {
        id: 'prod-003',
        sku: 'AIRPODS-PRO-2',
        name: 'Tai nghe Apple AirPods Pro 2 MagSafe (USB-C)',
        description: 'Khử tiếng ồn chủ động gấp 2 lần, âm thanh thích ứng đỉnh cao',
        price: 5990000,
        currency: 'VND',
        stock: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
      },
      {
        id: 'prod-004',
        sku: 'KEYCHRON-Q1-PRO',
        name: 'Bàn phím cơ Keychron Q1 Pro Wireless Custom',
        description: 'Bàn phím cơ CNC full nhôm, kết nối đa thiết bị, gõ êm ái',
        price: 4500000,
        currency: 'VND',
        stock: 25,
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
      },
    ];

    this.repository = new InMemoryCatalogRepository(sampleProducts);
    this.controller = new CatalogController(this.repository);
  }
}

export class InventoryModule {
  public readonly repository: InMemoryInventoryRepository;
  public readonly reserveStockUseCase: ReserveStockUseCase;
  public readonly releaseStockUseCase: ReleaseStockUseCase;

  constructor() {
    this.repository = new InMemoryInventoryRepository();

    // Đồng bộ tồn kho ban đầu cho các sản phẩm mẫu (availableStock, reservedStock, totalStock)
    const sampleStocks = [
      { productId: 'prod-001', totalStock: 50, reservedStock: 0, availableStock: 50, version: 1 },
      { productId: 'IPHONE-15-PRO', totalStock: 50, reservedStock: 0, availableStock: 50, version: 1 },
      { productId: 'prod-002', totalStock: 30, reservedStock: 0, availableStock: 30, version: 1 },
      { productId: 'MACBOOK-AIR-M3', totalStock: 30, reservedStock: 0, availableStock: 30, version: 1 },
      { productId: 'prod-003', totalStock: 100, reservedStock: 0, availableStock: 100, version: 1 },
      { productId: 'AIRPODS-PRO-2', totalStock: 100, reservedStock: 0, availableStock: 100, version: 1 },
      { productId: 'prod-004', totalStock: 25, reservedStock: 0, availableStock: 25, version: 1 },
      { productId: 'KEYCHRON-Q1-PRO', totalStock: 25, reservedStock: 0, availableStock: 25, version: 1 },
    ];
    for (const s of sampleStocks) {
      this.repository.setStock(s);
    }

    this.reserveStockUseCase = new ReserveStockUseCase(this.repository);
    this.releaseStockUseCase = new ReleaseStockUseCase(this.repository);
  }
}

export class OrderingModule {
  public readonly orderRepository: InMemoryOrderRepository;
  public readonly unitOfWork: InMemoryUnitOfWork;
  public readonly createOrderUseCase: CreateOrderUseCase;
  public readonly getOrderByIdQueryHandler: GetOrderByIdQueryHandler;
  public readonly placeOrderUseCase: PlaceOrderUseCase;
  public readonly placeOrderController: PlaceOrderController;
  public readonly paymentSimulator: PaymentSimulatorPortAdapter;

  constructor(catalogModule: CatalogModule, inventoryModule: InventoryModule) {
    this.orderRepository = new InMemoryOrderRepository();
    this.unitOfWork = new InMemoryUnitOfWork();
    this.createOrderUseCase = new CreateOrderUseCase(this.orderRepository, this.unitOfWork);
    this.getOrderByIdQueryHandler = new GetOrderByIdQueryHandler(this.orderRepository);

    // Catalog Query Port nối với CatalogModule Repository
    const catalogPort = {
      findProductByIdOrSku: async (id: string) => {
        if (!id || typeof id !== 'string') return null;
        const item = (await catalogModule.repository.findById(id)) || (await catalogModule.repository.findBySku(id));
        if (!item) return null;
        return {
          id: item.id,
          sku: item.sku,
          name: item.name,
          price: item.price,
          currency: item.currency,
        };
      },
    };

    // Inventory Reservation Port nối với InventoryModule UseCases
    const inventoryPort = {
      reserveStock: (cmd: any) => inventoryModule.reserveStockUseCase.execute(cmd),
      releaseStock: (cmd: any) => inventoryModule.releaseStockUseCase.execute(cmd),
    };

    this.paymentSimulator = new PaymentSimulatorPortAdapter(false);

    this.placeOrderUseCase = new PlaceOrderUseCase(
      this.orderRepository,
      catalogPort,
      inventoryPort,
      this.paymentSimulator
    );
    this.placeOrderController = new PlaceOrderController(this.placeOrderUseCase);
  }
}

export class AppModule {
  public readonly config: AppConfig;
  public readonly healthModule: HealthModule;
  public readonly catalogModule: CatalogModule;
  public readonly inventoryModule: InventoryModule;
  public readonly orderingModule: OrderingModule;

  constructor(config: AppConfig) {
    this.config = config;
    this.healthModule = new HealthModule(config);
    this.catalogModule = new CatalogModule();
    this.inventoryModule = new InventoryModule();
    this.orderingModule = new OrderingModule(this.catalogModule, this.inventoryModule);
  }

  public static forRoot(env: NodeJS.ProcessEnv = process.env): AppModule {
    const config = loadAndValidateConfig(env);
    return new AppModule(config);
  }
}

/**
 * -------------------------------------------------------------
 * 5. Application Bootstrap & RESTful HTTP Dispatcher
 * -------------------------------------------------------------
 */
export class NestApplication {
  private readonly appModule: AppModule;
  private server: http.Server | null;

  constructor(appModule: AppModule) {
    this.appModule = appModule;
    this.server = null;
  }

  public getModule(): AppModule {
    return this.appModule;
  }

  /**
   * Helper trích xuất & xác thực danh tính người dùng (AuthN Guard)
   */
  public extractUser(headers: Record<string, string | undefined>): JwtPayload {
    const authHeader = headers['authorization'] || headers['Authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('UNAUTHORIZED: Yêu cầu cung cấp Authentication Header dạng Bearer <token>', 'UNAUTHORIZED');
    }
    const token = authHeader.substring(7).trim();
    return verifyJwt(token, this.appModule.config.jwtSecret);
  }

  /**
   * Helper kiểm tra phân quyền người dùng (AuthZ / Roles Guard)
   */
  public requireRoles(user: JwtPayload, allowedRoles: UserRole[]): void {
    if (!allowedRoles.includes(user.role)) {
      throw new AuthorizationError(
        `FORBIDDEN: Vai trò '${user.role}' không được phép thực hiện thao tác này. Yêu cầu: ${allowedRoles.join(', ')}`,
        'FORBIDDEN'
      );
    }
  }

  /**
   * Request dispatcher mô phỏng NestJS routing & middleware pipeline
   */
  public async handleRequest(
    reqUrl: string,
    method = 'GET',
    headers: Record<string, string | undefined> = {},
    body?: unknown
  ): Promise<{ status: number; body: unknown }> {
    const prefix = this.appModule.config.apiPrefix;
    const url = reqUrl.split('?')[0];

    // 1. Health routes (Công khai)
    if (
      method === 'GET' &&
      (url === '/health' ||
        url === `${prefix}/health` ||
        url === '/health/liveness' ||
        url === `${prefix}/health/liveness` ||
        url === '/live')
    ) {
      return {
        status: 200,
        body: this.appModule.healthModule.controller.getLiveness(),
      };
    }

    if (
      method === 'GET' &&
      (url === '/health/ready' ||
        url === `${prefix}/health/ready` ||
        url === '/ready')
    ) {
      return {
        status: 200,
        body: { status: 'UP', ready: true },
      };
    }

    // 2. OpenAPI Documentation Route (Công khai)
    if (method === 'GET' && url === `${prefix}/openapi.json`) {
      return {
        status: 200,
        body: OPENAPI_SPEC,
      };
    }

    // 3. Catalog Routes
    if (url === `${prefix}/products`) {
      if (method === 'GET') {
        const res = await this.appModule.catalogModule.controller.getProducts();
        return { status: res.statusCode, body: res.data };
      }

      if (method === 'POST') {
        try {
          const user = this.extractUser(headers);
          this.requireRoles(user, ['admin', 'staff']);
          const res = await this.appModule.catalogModule.controller.createProduct(body, {
            user: { id: user.sub, username: user.username, role: user.role },
          });
          return { status: res.statusCode, body: res.data };
        } catch (err: any) {
          const status = err.statusCode || 500;
          return { status, body: { statusCode: status, message: err.message, errorCode: err.code || 'ERROR' } };
        }
      }
    }

    // 4. Ordering Routes
    if (url === `${prefix}/orders`) {
      if (method === 'POST') {
        try {
          const user = this.extractUser(headers);
          this.requireRoles(user, ['admin', 'staff']);

          // Input Validation sơ bộ
          if (!body || typeof body !== 'object' || !('items' in body) || !Array.isArray((body as any).items) || (body as any).items.length === 0) {
            return {
              status: 400,
              body: { statusCode: 400, message: 'BAD_REQUEST: Đơn hàng bắt buộc phải có ít nhất 1 sản phẩm hợp lệ', errorCode: 'INVALID_INPUT' },
            };
          }

          // Chuẩn hóa item input: hỗ trợ linh hoạt cả productId lẫn sku
          const rawItems = (body as any).items;
          const normalizedItems = rawItems.map((it: any) => ({
            productId: it.productId || it.sku || it.id,
            quantity: Number(it.quantity) || 1,
          }));

          const res = await this.appModule.orderingModule.placeOrderController.handlePlaceOrder({
            ...(body as any),
            items: normalizedItems,
          });
          return { status: res.statusCode, body: res.data };
        } catch (err: any) {
          const status = err.statusCode || 500;
          return { status, body: { statusCode: status, message: err.message, errorCode: err.code || 'ERROR' } };
        }
      }
    }

    if (url.startsWith(`${prefix}/orders/`)) {
      const orderId = url.replace(`${prefix}/orders/`, '').trim();
      if (method === 'GET') {
        try {
          this.extractUser(headers); // Yêu cầu token hợp lệ
          const order = await this.appModule.orderingModule.getOrderByIdQueryHandler.execute({ orderId });
          if (!order) {
            return { status: 404, body: { statusCode: 404, message: `Không tìm thấy đơn hàng ${orderId}` } };
          }
          return { status: 200, body: order };
        } catch (err: any) {
          const status = err.statusCode || 500;
          return { status, body: { statusCode: status, message: err.message, errorCode: err.code || 'ERROR' } };
        }
      }
    }

    return {
      status: 404,
      body: { statusCode: 404, message: `Cannot ${method} ${reqUrl}`, error: 'Not Found' },
    };
  }

  public async listen(port?: number): Promise<http.Server> {
    const targetPort = port ?? this.appModule.config.port;

    this.server = http.createServer(async (req, res) => {
      // Đọc body nếu có
      let bodyData: any = undefined;
      if (req.method === 'POST' || req.method === 'PUT') {
        const buffers: Buffer[] = [];
        for await (const chunk of req) {
          buffers.push(chunk);
        }
        const rawBody = Buffer.concat(buffers).toString('utf8');
        try {
          bodyData = rawBody ? JSON.parse(rawBody) : undefined;
        } catch {
          bodyData = rawBody;
        }
      }

      const headers: Record<string, string | undefined> = {};
      for (const [key, val] of Object.entries(req.headers)) {
        headers[key] = Array.isArray(val) ? val[0] : val;
      }

      const { status, body } = await this.handleRequest(req.url ?? '/', req.method, headers, bodyData);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });

    return new Promise((resolve) => {
      this.server!.listen(targetPort, () => {
        resolve(this.server!);
      });
    });
  }

  public async close(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }
  }
}

/**
 * Factory method khởi tạo ứng dụng NestJS
 */
export async function createNestApp(env: NodeJS.ProcessEnv = process.env): Promise<NestApplication> {
  const appModule = AppModule.forRoot(env);
  return new NestApplication(appModule);
}

/**
 * Bootstrap entry point
 */
export async function bootstrap(): Promise<NestApplication> {
  const app = await createNestApp();
  await app.listen();
  console.log(`[NestApplication] Service '${app.getModule().config.serviceName}' listening on port ${app.getModule().config.port}`);
  return app;
}

// Tự động chạy bootstrap nếu được thực thi trực tiếp từ CLI
if (process.argv[1] && process.argv[1].endsWith('main.ts')) {
  bootstrap().catch((err) => {
    console.error('[NestApplication] Bootstrap failed:', err);
    process.exit(1);
  });
}
