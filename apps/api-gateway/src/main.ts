// apps/api-gateway/src/main.ts
// NestJS Modular Monolith Bootstrap, Module Wiring, Configuration,
// AuthN/AuthZ (HMAC-SHA256 JWT, RBAC), OpenAPI 3.0 & Route Routing Pipeline (CommerceFlow Milestone M3)
// Tương thích Node.js 24 LTS native type-stripping (không dùng parameter properties hay legacy decorators).

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import type { CatalogRepository } from '../../catalog-service/src/catalog.controller.ts';
import {
  ReserveStockUseCase,
  ReleaseStockUseCase,
  InMemoryInventoryRepository,
} from '../../inventory-service/src/application/reserve-stock.ts';
import type { InventoryRepository } from '../../inventory-service/src/application/reserve-stock.ts';
import type { OrderRepository } from '../../order-service/src/application/ports/order-repository.ts';
import { PostgresCatalogRepository } from '../../catalog-service/src/infrastructure/postgres-catalog.repository.ts';
import { PostgresInventoryRepository } from '../../inventory-service/src/infrastructure/postgres-inventory.repository.ts';
import { PostgresOrderRepository } from '../../order-service/src/infrastructure/postgres-order.repository.ts';

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
  readonly catalogDatabaseUrl?: string;
  readonly inventoryDatabaseUrl?: string;
  readonly orderDatabaseUrl?: string;
  readonly jwtSecret: string;
}

export function loadAndValidateConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // 1. Kiểm tra và chuẩn hóa PORT
  const rawPort = env.PORT ?? '3030';
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
    catalogDatabaseUrl: env.CATALOG_DATABASE_URL || env.DATABASE_URL,
    inventoryDatabaseUrl: env.INVENTORY_DATABASE_URL || env.DATABASE_URL,
    orderDatabaseUrl: env.ORDER_DATABASE_URL || env.DATABASE_URL,
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
  public readonly repository: CatalogRepository;
  public readonly controller: CatalogController;

  constructor(databaseUrl?: string) {
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

    if (databaseUrl) {
      try {
        const pgRepo = new PostgresCatalogRepository(databaseUrl);
        pgRepo.initSchema().catch((err: any) => {
          console.warn('[CatalogModule] Auto-init schema warning:', err?.message || err);
        });
        this.repository = pgRepo;
        console.log('[CatalogModule] Using PostgresCatalogRepository (catalog_db)');
      } catch (err) {
        console.warn('[CatalogModule] Fallback to InMemoryCatalogRepository:', err);
        this.repository = new InMemoryCatalogRepository(sampleProducts);
      }
    } else {
      this.repository = new InMemoryCatalogRepository(sampleProducts);
    }
    this.controller = new CatalogController(this.repository);
  }
}

export class InventoryModule {
  public readonly repository: InventoryRepository;
  public readonly reserveStockUseCase: ReserveStockUseCase;
  public readonly releaseStockUseCase: ReleaseStockUseCase;

  constructor(databaseUrl?: string) {
    if (databaseUrl) {
      try {
        const pgRepo = new PostgresInventoryRepository(databaseUrl);
        pgRepo.initSchema().catch((err: any) => {
          console.warn('[InventoryModule] Auto-init schema warning:', err?.message || err);
        });
        this.repository = pgRepo;
        console.log('[InventoryModule] Using PostgresInventoryRepository (inventory_db)');
      } catch (err) {
        console.warn('[InventoryModule] Fallback to InMemoryInventoryRepository:', err);
        this.repository = new InMemoryInventoryRepository();
        this.seedSampleStocks(this.repository as InMemoryInventoryRepository);
      }
    } else {
      this.repository = new InMemoryInventoryRepository();
      this.seedSampleStocks(this.repository as InMemoryInventoryRepository);
    }

    this.reserveStockUseCase = new ReserveStockUseCase(this.repository);
    this.releaseStockUseCase = new ReleaseStockUseCase(this.repository);
  }

  private seedSampleStocks(repo: InMemoryInventoryRepository): void {
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
      repo.setStock(s);
    }
  }
}

export interface ChaosState {
  catalog: boolean;
  inventory: boolean;
  payment: boolean;
  ordering: boolean;
}

export class OrderingModule {
  public readonly orderRepository: OrderRepository;
  public readonly unitOfWork: InMemoryUnitOfWork;
  public readonly createOrderUseCase: CreateOrderUseCase;
  public readonly getOrderByIdQueryHandler: GetOrderByIdQueryHandler;
  public readonly placeOrderUseCase: PlaceOrderUseCase;
  public readonly placeOrderController: PlaceOrderController;
  public readonly paymentSimulator: PaymentSimulatorPortAdapter;

  constructor(
    catalogModule: CatalogModule,
    inventoryModule: InventoryModule,
    getChaosState: () => ChaosState = () => ({ catalog: true, inventory: true, payment: true, ordering: true }),
    databaseUrl?: string
  ) {
    if (databaseUrl) {
      try {
        const pgRepo = new PostgresOrderRepository(databaseUrl);
        pgRepo.initSchema().catch((err: any) => {
          console.warn('[OrderingModule] Auto-init schema warning:', err?.message || err);
        });
        this.orderRepository = pgRepo;
        console.log('[OrderingModule] Using PostgresOrderRepository (order_db)');
      } catch (err) {
        console.warn('[OrderingModule] Fallback to InMemoryOrderRepository:', err);
        this.orderRepository = new InMemoryOrderRepository();
      }
    } else {
      this.orderRepository = new InMemoryOrderRepository();
    }
    this.unitOfWork = new InMemoryUnitOfWork();
    this.createOrderUseCase = new CreateOrderUseCase(this.orderRepository, this.unitOfWork);
    this.getOrderByIdQueryHandler = new GetOrderByIdQueryHandler(this.orderRepository);

    // Catalog Query Port nối với CatalogModule Repository
    const catalogPort = {
      findProductByIdOrSku: async (id: string) => {
        if (!getChaosState().catalog) {
          throw new OrderLifecycleError(
            'CATALOG_SERVICE_UNAVAILABLE: Dịch vụ Catalog đang tạm ngắt kết nối (503)',
            'SERVICE_UNAVAILABLE'
          );
        }
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
      reserveStock: async (cmd: any) => {
        if (!getChaosState().inventory) {
          return {
            success: false,
            reason: 'INVENTORY_SERVICE_UNAVAILABLE: Dịch vụ Tồn kho đang tạm ngắt kết nối (503 Service Unavailable)',
          };
        }
        let result = await inventoryModule.reserveStockUseCase.execute(cmd);
        if (!result.success && cmd.items) {
          const alternateItems = [];
          for (const it of cmd.items) {
            const p = (await catalogModule.repository.findById(it.productId)) ||
                      (await catalogModule.repository.findBySku(it.productId));
            const altId = p ? (p.id === it.productId ? p.sku : p.id) : it.productId;
            alternateItems.push({ ...it, productId: altId });
          }
          const altResult = await inventoryModule.reserveStockUseCase.execute({
            ...cmd,
            items: alternateItems,
          });
          if (altResult.success) {
            result = altResult;
          }
        }

        // Sau khi giữ kho thành công, đồng bộ số lượng khả dụng
        if (result.success && cmd.items) {
          for (const it of cmd.items) {
            const p = (await catalogModule.repository.findById(it.productId)) ||
                      (await catalogModule.repository.findBySku(it.productId));
            if (p) {
              const s1 = await inventoryModule.repository.getStock(p.id);
              const s2 = await inventoryModule.repository.getStock(p.sku);
              const latestStock = s1 || s2;
              if (latestStock) {
                if (s1) await inventoryModule.repository.setStock({ ...latestStock, productId: p.id });
                if (s2) await inventoryModule.repository.setStock({ ...latestStock, productId: p.sku });
                await (catalogModule.repository as any).updateStock?.(p.id, latestStock.availableStock);
              }
            }
          }
        }
        return result;
      },
      releaseStock: async (cmd: any) => {
        const result = await inventoryModule.releaseStockUseCase.execute(cmd);
        return result;
      },
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
  public readonly chaosState: ChaosState = {
    catalog: true,
    inventory: true,
    payment: true,
    ordering: true,
  };

  constructor(config: AppConfig) {
    this.config = config;
    this.healthModule = new HealthModule(config);
    this.catalogModule = new CatalogModule(config.catalogDatabaseUrl);
    this.inventoryModule = new InventoryModule(config.inventoryDatabaseUrl);
    this.orderingModule = new OrderingModule(
      this.catalogModule,
      this.inventoryModule,
      () => this.chaosState,
      config.orderDatabaseUrl
    );
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
  ): Promise<{ status: number; body: unknown; contentType?: string }> {
    const prefix = this.appModule.config.apiPrefix;
    const url = reqUrl.split('?')[0];

    // 0. Web Dashboard Single Page Application (Giao diện trực quan cho người dùng)
    if (
      method === 'GET' &&
      (url === '/' ||
        url === '/dashboard' ||
        url === '/index.html' ||
        url === '/saga' ||
        url === '/ui')
    ) {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const candidatePaths = [
        path.resolve(currentDir, '../../web/public/index.html'),
        path.resolve(process.cwd(), 'apps/web/public/index.html'),
        path.resolve(process.cwd(), 'public/index.html'),
        path.resolve(process.cwd(), 'index.html'),
      ];

      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          const html = fs.readFileSync(p, 'utf8');
          return {
            status: 200,
            body: html,
            contentType: 'text/html; charset=utf-8',
          };
        }
      }

      return {
        status: 200,
        body: '<h1>CommerceFlow Platform</h1><p>index.html not found. Checked: ' + candidatePaths.join(', ') + '</p>',
        contentType: 'text/html; charset=utf-8',
      };
    }

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

    // 2.1. Chaos Engineering & Fault Injection Routes
    if (url === `${prefix}/chaos/status` && method === 'GET') {
      return { status: 200, body: this.appModule.chaosState };
    }

    if (url === `${prefix}/chaos/toggle` && method === 'POST') {
      const { service, enabled } = (body as any) || {};
      if (service && service in this.appModule.chaosState) {
        (this.appModule.chaosState as any)[service] = Boolean(enabled);
        if (service === 'payment') {
          this.appModule.orderingModule.paymentSimulator.setSimulateFailure(!enabled);
        }
      }
      return { status: 200, body: this.appModule.chaosState };
    }

    // 2.2. Kiểm tra trạng thái khả dụng của các vi dịch vụ (Fault Gates)
    if (!this.appModule.chaosState.catalog && (url === `${prefix}/products` || url.startsWith(`${prefix}/products/`))) {
      return {
        status: 503,
        body: {
          statusCode: 503,
          errorCode: 'CATALOG_SERVICE_DOWN',
          message: 'SERVICE_UNAVAILABLE: Dịch vụ Catalog đang tạm ngắt kết nối (Simulated Crash)',
        },
      };
    }

    if (!this.appModule.chaosState.inventory && (url === `${prefix}/inventory` || url.startsWith(`${prefix}/inventory/`))) {
      return {
        status: 503,
        body: {
          statusCode: 503,
          errorCode: 'INVENTORY_SERVICE_DOWN',
          message: 'SERVICE_UNAVAILABLE: Dịch vụ Tồn kho đang tạm ngắt kết nối (Simulated Crash)',
        },
      };
    }

    if (!this.appModule.chaosState.ordering && (url === `${prefix}/orders` || url.startsWith(`${prefix}/orders/`))) {
      return {
        status: 503,
        body: {
          statusCode: 503,
          errorCode: 'ORDERING_SERVICE_DOWN',
          message: 'SERVICE_UNAVAILABLE: Dịch vụ Đặt hàng đang tạm ngắt kết nối (Simulated Crash)',
        },
      };
    }

    // 3. Catalog Routes
    if (url === `${prefix}/products`) {
      if (method === 'GET') {
        const res = await this.appModule.catalogModule.controller.getProducts();
        if (res.statusCode === 200 && (res.data as any)?.items) {
          try {
            const stocks = await (this.appModule.inventoryModule.repository as any).getAllStocks();
            const stockMap = new Map(stocks.map((s: any) => [s.productId, s.availableStock]));
            const enrichedItems = (res.data as any).items.map((it: any) => {
              const liveStock = stockMap.get(it.id) ?? stockMap.get(it.sku) ?? it.availableStock;
              return {
                ...it,
                availableStock: liveStock,
                stock: liveStock,
              };
            });
            return { status: res.statusCode, body: { ...res.data, items: enrichedItems } };
          } catch {
            return { status: res.statusCode, body: res.data };
          }
        }
        return { status: res.statusCode, body: res.data };
      }

      if (method === 'POST') {
        try {
          const user = this.extractUser(headers);
          this.requireRoles(user, ['admin', 'staff']);

          // Hỗ trợ cả initialStock lẫn stock từ client
          const reqBody = typeof body === 'object' && body !== null
            ? { ...body, initialStock: (body as any).initialStock ?? (body as any).stock ?? 0 }
            : body;

          const res = await this.appModule.catalogModule.controller.createProduct(reqBody, {
            user: { id: user.sub, username: user.username, role: user.role },
          });

          // Tự động đồng bộ khởi tạo tồn kho sang Inventory Service (Event-driven / Domain Integration)
          if (res.statusCode === 201 && res.data) {
            const initialQty = Number(res.data.availableStock ?? (reqBody as any)?.initialStock ?? 0);
            const stockRecord = {
              productId: res.data.id,
              totalStock: initialQty,
              reservedStock: 0,
              availableStock: initialQty,
              version: 1,
            };
            await this.appModule.inventoryModule.repository.setStock(stockRecord);

            // Lưu thêm theo SKU để hỗ trợ query & reserve cả theo ID lẫn SKU
            if (res.data.sku && res.data.sku !== res.data.id) {
              await this.appModule.inventoryModule.repository.setStock({
                ...stockRecord,
                productId: res.data.sku,
              });
            }
          }

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

    if (url === `${prefix}/orders` && method === 'GET') {
      try {
        this.extractUser(headers);
        const orders = await (this.appModule.orderingModule.orderRepository as any).findAll();
        const serialized = (orders || []).map((o: any) => ({
          id: o.id,
          customerId: o.customerId,
          status: typeof o.getStatus === 'function' ? o.getStatus() : o.status,
          totalAmount: typeof o.getTotalAmount === 'function' ? o.getTotalAmount() : o.totalAmount,
          items: (typeof o.getItems === 'function' ? o.getItems() : (o.items || [])).map((it: any) => ({
            productId: it.productId,
            quantity: it.quantity?.value ?? it.quantity,
            unitPrice: it.unitPrice?.amount ?? it.unitPrice,
            currency: it.unitPrice?.currency ?? 'VND',
          })),
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        }));
        return { status: 200, body: serialized.reverse() };
      } catch (err: any) {
        const status = err.statusCode || 500;
        return { status, body: { statusCode: status, message: err.message, errorCode: err.code || 'ERROR' } };
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

    // 5. Inventory Routes
    if (url === `${prefix}/inventory` && method === 'GET') {
      const products = (await this.appModule.catalogModule.repository.findAll()) || [];
      const stocks = await (this.appModule.inventoryModule.repository as any).getAllStocks();
      const stockMap = new Map(stocks.map((s: any) => [s.productId, s]));

      // Tự động đảm bảo mọi sản phẩm từ catalog đều có tồn kho tương ứng trong inventory
      for (const prod of products) {
        if (!stockMap.has(prod.id) && !stockMap.has(prod.sku)) {
          const newStock = {
            productId: prod.id,
            totalStock: Number(prod.stock) || 0,
            reservedStock: 0,
            availableStock: Number(prod.stock) || 0,
            version: 1,
          };
          await this.appModule.inventoryModule.repository.setStock(newStock);
          if (prod.sku && prod.sku !== prod.id) {
            await this.appModule.inventoryModule.repository.setStock({
              ...newStock,
              productId: prod.sku,
            });
          }
          stocks.push(newStock);
          stockMap.set(prod.id, newStock);
        }
      }

      const productMap = new Map(products.map((p: any) => [p.id, p]));
      const enriched = (stocks || []).map((s: any) => {
        const prod = productMap.get(s.productId) || products.find((p: any) => p.sku === s.productId);
        return {
          ...s,
          productName: prod?.name || s.productId,
          sku: prod?.sku || s.productId,
          price: prod?.price || 0,
          currency: prod?.currency || 'VND',
        };
      });
      const seen = new Set<string>();
      const uniqueEnriched = enriched.filter((item: any) => {
        const key = item.sku;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { status: 200, body: uniqueEnriched };
    }

    if (url === `${prefix}/inventory/adjust` && method === 'POST') {
      try {
        const user = this.extractUser(headers);
        this.requireRoles(user, ['admin', 'staff']);
        const { productId, deltaAvailable, deltaTotal } = (body as any) || {};
        const current = await this.appModule.inventoryModule.repository.getStock(productId);
        if (!current) {
          return { status: 404, body: { statusCode: 404, message: `Product ${productId} not found in inventory` } };
        }
        current.availableStock = Math.max(0, current.availableStock + (Number(deltaAvailable) || 0));
        current.totalStock = Math.max(0, current.totalStock + (Number(deltaTotal || deltaAvailable) || 0));
        current.version++;
        await this.appModule.inventoryModule.repository.setStock(current);
        return { status: 200, body: current };
      } catch (err: any) {
        const status = err.statusCode || 500;
        return { status, body: { statusCode: status, message: err.message, errorCode: err.code || 'ERROR' } };
      }
    }

    // 6. Identity & Token Helper Route
    if (url === `${prefix}/auth/token` && method === 'POST') {
      const { role = 'staff', username } = (body as any) || {};
      const validRole = ['admin', 'staff', 'viewer'].includes(role) ? (role as UserRole) : 'staff';
      const token = generateJwt(
        {
          sub: `user-${validRole}-${Date.now().toString(36)}`,
          role: validRole,
          username: username || `${validRole}_operator`,
        },
        this.appModule.config.jwtSecret
      );
      return {
        status: 200,
        body: {
          token,
          role: validRole,
          username: username || `${validRole}_operator`,
          expiresIn: 3600,
        },
      };
    }

    return {
      status: 404,
      body: { statusCode: 404, message: `Cannot ${method} ${reqUrl}`, error: 'Not Found' },
    };
  }

  public async listen(port?: number): Promise<http.Server> {
    const targetPort = port ?? this.appModule.config.port;

    this.server = http.createServer(async (req, res) => {
      // Thiết lập CORS header cho phép trình duyệt truy cập API tự do
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

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

      const result: any = await this.handleRequest(req.url ?? '/', req.method, headers, bodyData);
      if (result.contentType && result.contentType.startsWith('text/html')) {
        res.writeHead(result.status, { 'Content-Type': result.contentType });
        res.end(typeof result.body === 'string' ? result.body : String(result.body));
      } else {
        res.writeHead(result.status, { 'Content-Type': result.contentType ?? 'application/json' });
        res.end(JSON.stringify(result.body));
      }
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
