// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-011/demo.mjs
import assert from 'node:assert/strict';
const config = {PORT:Number(process.env.PORT || 3000)};
assert.ok(config.PORT > 0 && config.PORT < 65536);
console.log('MICRO_LAB_OK CF-011');
