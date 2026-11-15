// Atomic reservation demo: JS single-process model; real database needs conditional SQL update.
import assert from 'node:assert/strict';
let available = 1;
function reserve(quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('INVALID_QUANTITY');
  if (available < quantity) return { accepted: false, reason: 'OUT_OF_STOCK' };
  available -= quantity; // In PostgreSQL replace with one atomic UPDATE ... WHERE available >= quantity.
  return { accepted: true };
}
const first = reserve(1);
const second = reserve(1);
assert.equal(first.accepted, true);
assert.deepEqual(second, { accepted: false, reason: 'OUT_OF_STOCK' });
assert.equal(available, 0);
assert.throws(() => reserve(0), /INVALID_QUANTITY/);
console.log('RESERVATION_RACE_DEMO_OK');
