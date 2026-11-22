// apps/api-gateway/src/main.ts
// NestJS Modular Monolith Bootstrap, Module Wiring & Configuration (CommerceFlow Milestone M3)
// Quản lý cấu hình tập trung (Fail-fast Validation), cách ly Secrets,
// và phân tách rõ ràng giữa Liveness Health Check (không phụ thuộc DB) và Readiness Health Check.
// Tương thích Node.js 24 LTS native type-stripping (không dùng parameter properties hay legacy decorators).

import http from 'node:http';
import { CreateOrderUseCase, GetOrderByIdQueryHandler, InMemoryUnitOfWork } from '../../order-service/src/application/use-cases/create-order.ts';
import { InMemoryOrderRepository } from '../../order-service/src/application/ports/order-repository.ts';
import { CatalogController, InMemoryCatalogRepository } from '../../catalog-service/src/catalog.controller.ts';

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
  readonly jwtSecret?: string;
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
  const jwtSecret = env.JWT_SECRET;
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
 * 2. Health Module & Controller (Liveness vs Readiness)
 * -------------------------------------------------------------
 * Thử thách độc lập: Health route không kết nối DB để phục vụ Liveness probe.
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

  /**
   * Liveness Probe: Kiểm tra xem tiến trình Node.js có đang chạy và phản hồi hay không.
   * TUYỆT ĐỐI KHÔNG phụ thuộc vào Database hay mạng ngoại vi để tránh Cascade Failures.
   */
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

  /**
   * Readiness Probe: Kiểm tra xem dịch vụ đã sẵn sàng nhận traffic nghiệp vụ hay chưa (có thể kiểm tra DB).
   */
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

/**
 * -------------------------------------------------------------
 * 3. Module Wiring (NestJS Architecture Structure)
 * -------------------------------------------------------------
 */
export class HealthModule {
  public readonly controller: HealthController;

  constructor(config: AppConfig) {
    this.controller = new HealthController(config);
  }
}

export class OrderingModule {
  public readonly orderRepository: InMemoryOrderRepository;
  public readonly unitOfWork: InMemoryUnitOfWork;
  public readonly createOrderUseCase: CreateOrderUseCase;
  public readonly getOrderByIdQueryHandler: GetOrderByIdQueryHandler;

  constructor() {
    this.orderRepository = new InMemoryOrderRepository();
    this.unitOfWork = new InMemoryUnitOfWork();
    this.createOrderUseCase = new CreateOrderUseCase(this.orderRepository, this.unitOfWork);
    this.getOrderByIdQueryHandler = new GetOrderByIdQueryHandler(this.orderRepository);
  }
}

export class CatalogModule {
  public readonly repository: InMemoryCatalogRepository;
  public readonly controller: CatalogController;

  constructor() {
    this.repository = new InMemoryCatalogRepository();
    this.controller = new CatalogController(this.repository);
  }
}

export class AppModule {
  public readonly config: AppConfig;
  public readonly healthModule: HealthModule;
  public readonly orderingModule: OrderingModule;
  public readonly catalogModule: CatalogModule;

  constructor(config: AppConfig) {
    this.config = config;
    this.healthModule = new HealthModule(config);
    this.orderingModule = new OrderingModule();
    this.catalogModule = new CatalogModule();
  }

  public static forRoot(env: NodeJS.ProcessEnv = process.env): AppModule {
    const config = loadAndValidateConfig(env);
    return new AppModule(config);
  }
}

/**
 * -------------------------------------------------------------
 * 4. Application Bootstrap & Dispatcher
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
   * Request dispatcher mô phỏng NestJS routing pipeline
   */
  public handleRequest(reqUrl: string, method = 'GET'): { status: number; body: unknown } {
    const prefix = this.appModule.config.apiPrefix;

    if (method === 'GET' && (reqUrl === '/health' || reqUrl === `${prefix}/health`)) {
      return {
        status: 200,
        body: this.appModule.healthModule.controller.getLiveness(),
      };
    }

    if (method === 'GET' && reqUrl === `${prefix}/health/ready`) {
      return {
        status: 200,
        body: { status: 'UP', ready: true },
      };
    }

    return {
      status: 404,
      body: { statusCode: 404, message: `Cannot ${method} ${reqUrl}`, error: 'Not Found' },
    };
  }

  public async listen(port?: number): Promise<http.Server> {
    const targetPort = port ?? this.appModule.config.port;

    this.server = http.createServer((req, res) => {
      const { status, body } = this.handleRequest(req.url ?? '/', req.method);
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
  console.log(`[NestApplication] Service '${app.getModule().config.serviceName}' initialized on port ${app.getModule().config.port}`);
  return app;
}

// Tự động chạy bootstrap nếu được thực thi trực tiếp từ CLI
if (process.argv[1] && process.argv[1].endsWith('main.ts')) {
  bootstrap().catch((err) => {
    console.error('[NestApplication] Bootstrap failed:', err);
    process.exit(1);
  });
}

