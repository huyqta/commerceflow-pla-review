// In-memory approximation. No real ACID guarantee; use PostgreSQL transaction in actual lab.
import assert from 'node:assert/strict';
const db = { orders: new Map(), outbox: new Map(), inbox: new Set() };
let sideEffects = 0;
function createOrderAndOutbox(id) {
  // Simulate a single logical commit boundary; replace with DB transaction for real atomicity.
  if (db.orders.has(id)) throw new Error('DUPLICATE_ORDER');
  db.orders.set(id, 'PENDING');
  db.outbox.set(`created-${id}`, { eventId: `created-${id}`, orderId: id });
}
function consume(event) {
  if (db.inbox.has(event.eventId)) return 'duplicate';
  db.inbox.add(event.eventId); // Real system: inbox insert and side effect must commit together.
  sideEffects += 1;
  return 'applied';
}
createOrderAndOutbox('order-1');
const event = db.outbox.get('created-order-1');
assert.equal(consume(event), 'applied');
assert.equal(consume(event), 'duplicate');
assert.equal(sideEffects, 1);
assert.equal(db.orders.get('order-1'), 'PENDING');
console.log('OUTBOX_INBOX_DEMO_OK');
