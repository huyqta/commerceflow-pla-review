// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-008/demo.mjs
import assert from 'node:assert/strict';
const repository = {save: async order=>order.id, get:async id=>({id})};
assert.equal(await repository.save({id:'o1'}),'o1');
console.log('MICRO_LAB_OK CF-008');
