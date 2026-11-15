// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-021/demo.mjs
import assert from 'node:assert/strict';
const inbox = new Set(); let sideEffects=0; const handle=id=>{if(inbox.has(id)) return; inbox.add(id); sideEffects++;};
handle('event-1');handle('event-1'); assert.equal(sideEffects,1);
console.log('MICRO_LAB_OK CF-021');
