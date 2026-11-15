// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-039/demo.mjs
import assert from 'node:assert/strict';
const drill={failure:'pubsub unavailable',recovery:'retry + inbox dedupe'};
assert.match(drill.recovery,/dedupe/);
console.log('MICRO_LAB_OK CF-039');
