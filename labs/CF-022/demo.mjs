// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-022/demo.mjs
import assert from 'node:assert/strict';
const saga={state:'PENDING',stockReserved:true}; const onPaymentFailure=()=>{saga.state='CANCELLED';saga.stockReserved=false;};
onPaymentFailure(); assert.deepEqual(saga,{state:'CANCELLED',stockReserved:false});
console.log('MICRO_LAB_OK CF-022');
