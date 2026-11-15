import { Order } from '../src/domain/order.ts';
const order = Order.create('smoke-001');
console.log('STARTER_SMOKE_OK', order.getStatus());
