// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-015/demo.mjs
import assert from 'node:assert/strict';
const transitions={PENDING:['CONFIRMED','CANCELLED'],CONFIRMED:[],CANCELLED:[]};
assert.equal(transitions.CANCELLED.includes('CONFIRMED'),false);
console.log('MICRO_LAB_OK CF-015');
