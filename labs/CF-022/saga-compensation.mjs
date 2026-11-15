// Deterministic saga transition demo: no payment gateway and no real event transport.
import assert from 'node:assert/strict';
const state = { status: 'PENDING', reserved: false, payments: 0, compensations: 0 };
const handled = new Set();
function apply(event) {
  if (handled.has(event.id)) return; // Protect duplicate broker delivery.
  handled.add(event.id);
  if (event.type === 'InventoryReserved' && state.status === 'PENDING') state.reserved = true;
  if (event.type === 'PaymentFailed' && state.status === 'PENDING') {
    if (state.reserved) { state.reserved = false; state.compensations += 1; }
    state.status = 'CANCELLED';
  }
}
apply({ id:'i-1', type:'InventoryReserved' });
apply({ id:'p-1', type:'PaymentFailed' });
apply({ id:'p-1', type:'PaymentFailed' }); // Duplicate should have no extra side effect.
assert.equal(state.status,'CANCELLED');
assert.equal(state.reserved,false);
assert.equal(state.compensations,1);
console.log('SAGA_COMPENSATION_DEMO_OK');
