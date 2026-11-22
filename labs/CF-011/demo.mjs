// Micro-lab kiểm chứng thực chất cho CF-011
// Import và kiểm tra trực tiếp NestJS workspace, module wiring và configuration
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const mainFilePath = path.resolve('apps/api-gateway/src/main.ts');
assert.ok(
  fs.existsSync(mainFilePath),
  'Thất bại: apps/api-gateway/src/main.ts không tồn tại!'
);

// Dynamic import main module
const mainModule = await import(`file:///${mainFilePath.replace(/\\/g, '/')}`);
const {
  loadAndValidateConfig,
  ConfigurationError,
  createNestApp,
  HealthController,
  AppModule,
} = mainModule;

assert.ok(loadAndValidateConfig, 'Thất bại: Chưa export loadAndValidateConfig!');
assert.ok(createNestApp, 'Thất bại: Chưa export createNestApp!');
assert.ok(HealthController, 'Thất bại: Chưa export HealthController!');

// 1. Kiểm chứng Configuration Validation & Fail-fast
// A. Cấu hình mặc định hợp lệ
const defaultConfig = loadAndValidateConfig({
  PORT: '3000',
  NODE_ENV: 'development',
});
assert.equal(defaultConfig.port, 3000);
assert.equal(defaultConfig.nodeEnv, 'development');
assert.equal(defaultConfig.serviceName, 'commerceflow-api-gateway');

// B. Cấu hình hợp lệ với Port tùy biến
const customConfig = loadAndValidateConfig({
  PORT: '8080',
  NODE_ENV: 'production',
  JWT_SECRET: 'production_high_entropy_secret_key_12345',
});
assert.equal(customConfig.port, 8080);
assert.equal(customConfig.nodeEnv, 'production');

// C. Lỗi PORT không hợp lệ (số âm, vượt quá 65535, ký tự)
assert.throws(
  () => loadAndValidateConfig({ PORT: '-5' }),
  /INVALID_PORT/,
  'Phải từ chối PORT âm'
);
assert.throws(
  () => loadAndValidateConfig({ PORT: '70000' }),
  /INVALID_PORT/,
  'Phải từ chối PORT > 65535'
);
assert.throws(
  () => loadAndValidateConfig({ PORT: 'invalid_abc' }),
  /INVALID_PORT/,
  'Phải từ chối PORT không phải là số'
);

// D. Lỗi Bảo mật: Cấm sử dụng secret mặc định trên Production
assert.throws(
  () =>
    loadAndValidateConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'local_only_change_me',
    }),
  /INSECURE_PRODUCTION_SECRET/,
  'Bảo mật: Phải chặn đứng secret mặc định trên Production'
);

// 2. Kiểm chứng Module Wiring & Dependency Injection
const app = await createNestApp({
  PORT: '3001',
  NODE_ENV: 'test',
});
const appModule = app.getModule();
assert.ok(appModule instanceof AppModule);
assert.ok(appModule.healthModule, 'HealthModule phải được wiring');
assert.ok(appModule.orderingModule, 'OrderingModule phải được wiring');

// Kiểm chứng tương tác nghiệp vụ qua Module đã wiring
const orderingModule = appModule.orderingModule;
const orderResult = await orderingModule.createOrderUseCase.execute({
  orderId: 'ord-nest-wire-01',
  customerId: 'cust-nest',
  items: [{ productId: 'p1', quantity: 2, unitPrice: 150 }],
});
assert.equal(orderResult.orderId, 'ord-nest-wire-01');
assert.equal(orderResult.totalAmount, 300);

// 3. Kiểm chứng Thử thách Độc lập: Health Route Liveness KHÔNG phụ thuộc vào DB
const healthController = appModule.healthModule.controller;
const liveness = healthController.getLiveness();

assert.equal(liveness.status, 'UP', 'Liveness phải luôn trả về UP khi process hoạt động');
assert.equal(liveness.checks.liveness, 'OK');
assert.ok(typeof liveness.uptimeSeconds === 'number');

// Giả lập cơ sở dữ liệu bị sập hoàn toàn (DB Disconnected)
const readinessWhenDbDown = await healthController.getReadiness(false);
assert.equal(
  readinessWhenDbDown.status,
  'DOWN',
  'Readiness probe phải báo DOWN khi DB mất kết nối để dừng nhận traffic'
);
assert.equal(
  readinessWhenDbDown.checks.database,
  'DISCONNECTED',
  'DB check phải là DISCONNECTED'
);

// NHƯNG Liveness probe vẫn hoàn toàn UP để Kubernetes không restart container vô cớ!
const livenessStillUp = healthController.getLiveness();
assert.equal(
  livenessStillUp.status,
  'UP',
  'Liveness probe TUYỆT ĐỐI KHÔNG được DOWN khi chỉ có DB sập!'
);

// 4. Kiểm chứng HTTP Request Dispatching qua Gateway
const resHealth = app.handleRequest('/health', 'GET');
assert.equal(resHealth.status, 200);
assert.equal(resHealth.body.status, 'UP');

const res404 = app.handleRequest('/unknown-path', 'GET');
assert.equal(res404.status, 404);

console.log(
  'MICRO_LAB_OK CF-011 (Đã kiểm chứng thực tế NestJS workspace, module wiring & configuration thành công)'
);
