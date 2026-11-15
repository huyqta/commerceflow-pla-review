// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-013/demo.mjs
import assert from 'node:assert/strict';
const validatePrice = v => Number.isFinite(v) && v >= 0;
assert.equal(validatePrice(-1),false); assert.equal(validatePrice(10),true);
console.log('MICRO_LAB_OK CF-013');
