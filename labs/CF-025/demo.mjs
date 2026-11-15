// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-025/demo.mjs
import assert from 'node:assert/strict';
const view=state=>state.loading?'loading':state.error?'error':state.items.length?'data':'empty';
assert.equal(view({loading:false,error:null,items:[]}), 'empty');
console.log('MICRO_LAB_OK CF-025');
