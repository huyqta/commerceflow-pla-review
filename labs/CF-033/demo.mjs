// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-033/demo.mjs
import assert from 'node:assert/strict';
const monthlyBudget=50; const threshold=[.25,.5,.8,1];
assert.deepEqual(threshold.map(x=>x*monthlyBudget),[12.5,25,40,50]);
console.log('MICRO_LAB_OK CF-033');
