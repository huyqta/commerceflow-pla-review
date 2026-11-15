// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-036/demo.mjs
import assert from 'node:assert/strict';
const deployment={replicas:2,readinessPath:'/ready'};
assert.equal(deployment.replicas,2);
console.log('MICRO_LAB_OK CF-036');
