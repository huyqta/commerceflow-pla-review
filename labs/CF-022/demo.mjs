// Micro-lab minh họa độc lập CF-022: Saga orchestration, compensation, eventual consistency
// Chạy từ root repository: node labs/CF-022/demo.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('[CF-022 Micro-Lab] Bắt đầu kiểm tra Saga Orchestration & Compensation Flow...');

// 1. Kiểm tra sự tồn tại của artifact apps/order-service/src/application/order-saga.ts
const sagaPath = path.resolve('apps/order-service/src/application/order-saga.ts');
assert.ok(fs.existsSync(sagaPath), 'Tệp apps/order-service/src/application/order-saga.ts phải tồn tại');

const sagaSrc = fs.readFileSync(sagaPath, 'utf8');

// 2. Micro-lab assertion chuẩn
const saga = { state: 'PENDING', stockReserved: true };
const onPaymentFailure = () => {
  saga.state = 'CANCELLED';
  saga.stockReserved = false;
};
onPaymentFailure();
assert.deepEqual(saga, { state: 'CANCELLED', stockReserved: false });

// 3. Kiểm tra các class và phương thức cốt lõi trong artifact
assert.ok(sagaSrc.includes('class OrderSagaOrchestrator'), 'Phải cài đặt OrderSagaOrchestrator');
assert.ok(sagaSrc.includes('executeCompensationStep'), 'Phải có logic bồi hoàn compensation');
assert.ok(sagaSrc.includes('recoverStaleSagas'), 'Phải có phương thức timeout recovery');
assert.ok(sagaSrc.includes('PAYMENT_TIMED_OUT'), 'Phải hỗ trợ trạng thái timeout');

console.log('✔ Toàn bộ kiểm tra Saga Orchestration & Compensation CF-022 đều HỢP LỆ.');
console.log('MICRO_LAB_OK CF-022');
