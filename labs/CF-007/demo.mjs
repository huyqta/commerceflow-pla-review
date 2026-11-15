// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-007/demo.mjs
import assert from 'node:assert/strict';
const event = Object.freeze({type:'OrderCreated', orderId:'o1', version:1});
assert.equal(event.type,'OrderCreated'); assert.ok(Object.isFrozen(event));
console.log('MICRO_LAB_OK CF-007');
