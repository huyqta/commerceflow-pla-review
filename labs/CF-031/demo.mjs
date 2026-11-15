// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-031/demo.mjs
import assert from 'node:assert/strict';
const digest='sha256:'+'a'.repeat(64);
assert.match(digest,/^sha256:[a-f0-9]{64}$/);
console.log('MICRO_LAB_OK CF-031');
