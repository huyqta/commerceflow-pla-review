// Micro-lab minh họa độc lập, KHÔNG thay thế implementation thực tế.
// Chạy từ root: node labs/CF-009/demo.mjs
import assert from 'node:assert/strict';
const useCase = async (cmd,repo)=>{if (!cmd.customerId) throw Error('missing customer'); return repo.save({id:'o1'});};
assert.equal(await useCase({customerId:'c1'},{save:async x=>x.id}),'o1');
console.log('MICRO_LAB_OK CF-009');
