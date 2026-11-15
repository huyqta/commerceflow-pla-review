// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-023/demo.mjs
import assert from 'node:assert/strict';
const backoff=attempt=>Math.min(100*2**attempt,5000);
assert.deepEqual([0,1,2].map(backoff),[100,200,400]);
console.log('MICRO_LAB_OK CF-023');
