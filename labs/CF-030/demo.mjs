// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-030/demo.mjs
import assert from 'node:assert/strict';
const contract={schemaVersion:1,required:['eventId','orderId']};
assert.ok(contract.required.includes('eventId'));
console.log('MICRO_LAB_OK CF-030');
