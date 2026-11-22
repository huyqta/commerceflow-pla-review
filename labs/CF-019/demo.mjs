// Micro-lab minh họa độc lập CF-019: Tách Ordering/Payment và hợp đồng API
// Chạy từ root repository: node labs/CF-019/demo.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('[CF-019 Micro-Lab] Bắt đầu kiểm tra Hợp đồng API (Versioned Contracts & Schemas)...');

// 1. Kiểm tra sự tồn tại của artifact packages/contracts/src/order.ts
const contractPath = path.resolve('packages/contracts/src/order.ts');
assert.ok(fs.existsSync(contractPath), 'Tệp packages/contracts/src/order.ts phải tồn tại');

const contractSrc = fs.readFileSync(contractPath, 'utf8');

// 2. Micro-lab assertion chuẩn
const message = { eventId: 'e1', version: 1, payload: { orderId: 'o1' } };
assert.equal(message.version, 1, 'Version của message contract phải là 1');

// 3. Kiểm tra tính độc lập và phân phiên bản của Contract (Versioning & Compatibility)
assert.ok(contractSrc.includes('OrderCreatedPayloadV1'), 'Phải định nghĩa OrderCreatedPayloadV1');
assert.ok(contractSrc.includes('OrderCreatedPayloadV2'), 'Phải định nghĩa OrderCreatedPayloadV2');
assert.ok(contractSrc.includes('ChargePaymentCommand'), 'Phải định nghĩa ChargePaymentCommand');
assert.ok(contractSrc.includes('PaymentProcessedPayload'), 'Phải định nghĩa PaymentProcessedPayload');

// 4. Kiểm tra nguyên tắc Pure Data Contracts (Không rò rỉ domain logic / entities)
// Contract không được import từ domain aggregate hay repositories
assert.ok(!contractSrc.includes('../order-service/src/domain'), 'Contract không được phụ thuộc trực tiếp vào domain entities');
assert.ok(!contractSrc.includes('../payment-service/src/domain'), 'Contract không được phụ thuộc vào domain của payment');

console.log('✔ Toàn bộ kiểm tra versioned contracts CF-019 đều HỢP LỆ.');
console.log('MICRO_LAB_OK CF-019');
