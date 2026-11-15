// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-016/demo.mjs
import assert from 'node:assert/strict';
const authz = (role, action)=>role==='admin' || action==='read';
assert.equal(authz('viewer','delete'),false);
console.log('MICRO_LAB_OK CF-016');
