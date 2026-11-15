// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-006/demo.mjs
import assert from 'node:assert/strict';
class Quantity { constructor(value) { if (!Number.isInteger(value) || value <= 0) throw Error('invalid quantity'); this.value=value; } }
assert.throws(()=>new Quantity(0)); assert.equal(new Quantity(2).value,2);
console.log('MICRO_LAB_OK CF-006');
