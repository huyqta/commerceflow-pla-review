// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-004/demo.mjs
import assert from 'node:assert/strict';
const ownership = new Map([['OrderCreated', 'Ordering'], ['InventoryReserved', 'Inventory']]);
assert.equal(ownership.get('InventoryReserved'), 'Inventory');
console.log('MICRO_LAB_OK CF-004');
