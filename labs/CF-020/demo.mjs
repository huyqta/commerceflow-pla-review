// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-020/demo.mjs
import assert from 'node:assert/strict';
const published=[]; const bus={publish: async e=>published.push(e)};
await bus.publish({eventId:'e1'}); assert.equal(published.length,1);
console.log('MICRO_LAB_OK CF-020');
