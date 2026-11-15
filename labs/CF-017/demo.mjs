// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-017/demo.mjs
import assert from 'node:assert/strict';
const owner={catalog:'catalog_db',order:'order_db',inventory:'inventory_db'};
assert.notEqual(owner.catalog,owner.inventory);
console.log('MICRO_LAB_OK CF-017');
