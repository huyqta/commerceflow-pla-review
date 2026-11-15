// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-014/demo.mjs
import assert from 'node:assert/strict';
let available=1; const reserve=n=>{if (available<n) return false; available-=n; return true;};
assert.equal(reserve(1),true); assert.equal(reserve(1),false);
console.log('MICRO_LAB_OK CF-014');
