// tests/architecture/order-boundary.test.ts
// Kiểm thử ranh giới kiến trúc (Clean Architecture / Dependency Rule)
// và toàn bộ các Business Invariants / Negative Cases của Order Aggregate & Use Cases.
// Chạy trực tiếp qua Node.js native test runner: node --test tests/architecture/order-boundary.test.ts

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe, it } from 'node:test';

import { Order, Quantity, Money } from '../../apps/order-service/src/domain/order.aggregate.ts';
import { OrderCreatedEvent } from '../../apps/order-service/src/domain/events/order-created.ts';
import { InMemoryOrderRepository } from '../../apps/order-service/src/application/ports/order-repository.ts';
import {
  CreateOrderUseCase,
  GetOrderByIdQueryHandler,
  InMemoryUnitOfWork,
  OrderValidationError,
  OrderAlreadyExistsError,
} from '../../apps/order-service/src/application/use-cases/create-order.ts';

describe('1. Kiến trúc & Quy tắc phụ thuộc (Clean Architecture Dependency Rule)', () => {
  const domainDir = path.resolve('apps/order-service/src/domain');
  const applicationDir = path.resolve('apps/order-service/src/application');

  function getAllFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getAllFiles(fullPath));
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it('Tầng Domain TUYỆT ĐỐI KHÔNG import ORM (Prisma, TypeORM, Mongoose)', () => {
    const domainFiles = getAllFiles(domainDir);
    assert.ok(domainFiles.length > 0, 'Phải có các tệp mã nguồn trong domain');

    const forbiddenImports = ['@prisma/client', 'prisma', 'typeorm', 'sequelize', 'mongoose'];

    for (const file of domainFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const forbidden of forbiddenImports) {
        assert.ok(
          !content.includes(`'${forbidden}'`) &&
            !content.includes(`"${forbidden}"`) &&
            !content.includes(`/${forbidden}`),
          `Vi phạm kiến trúc tại ${path.relative(process.cwd(), file)}: Domain không được import ${forbidden}`
        );
      }
    }
  });

  it('Tầng Domain TUYỆT ĐỐI KHÔNG import Framework hạ tầng (@nestjs, express) hoặc tầng ngoài', () => {
    const domainFiles = getAllFiles(domainDir);
    const forbiddenExternal = ['@nestjs', 'express', 'fastify', '../application', '../infrastructure'];

    for (const file of domainFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const forbidden of forbiddenExternal) {
        assert.ok(
          !content.includes(forbidden),
          `Vi phạm kiến trúc tại ${path.relative(process.cwd(), file)}: Domain không được import ${forbidden}`
        );
      }
    }
  });

  it('Tầng Application Ports & Use Cases TUYỆT ĐỐI KHÔNG import Prisma', () => {
    const appFiles = getAllFiles(applicationDir);
    for (const file of appFiles) {
      const content = fs.readFileSync(file, 'utf8');
      assert.ok(
        !content.includes('@prisma/client') && !content.includes("'prisma'") && !content.includes('"prisma"'),
        `Vi phạm kiến trúc tại ${path.relative(process.cwd(), file)}: Application layer không được import Prisma`
      );
    }
  });
});

describe('2. Kiểm thử điều kiện biên Domain (Domain Invariants & Negative Cases)', () => {
  it('Quantity: Từ chối giá trị <= 0 hoặc số thập phân', () => {
    assert.throws(() => new Quantity(0), /INVALID_QUANTITY|QUANTITY_MUST_BE_POSITIVE/);
    assert.throws(() => new Quantity(-10), /INVALID_QUANTITY|QUANTITY_MUST_BE_POSITIVE/);
    assert.throws(() => new Quantity(2.5), /INVALID_QUANTITY|QUANTITY_MUST_BE_INTEGER/);
    assert.equal(new Quantity(1).value, 1);
  });

  it('Money: Từ chối số tiền âm hoặc NaN', () => {
    assert.throws(() => new Money(-100), /INVALID_MONEY_AMOUNT/);
    assert.throws(() => new Money(NaN), /INVALID_MONEY_AMOUNT/);
    assert.equal(new Money(0).amount, 0);
    assert.equal(new Money(150, 'USD').currency, 'USD');
  });

  it('Order.create: Từ chối mã đơn rỗng hoặc mã khách hàng rỗng', () => {
    const sampleItem = [{ productId: 'p1', quantity: 1, unitPrice: 100 }];
    assert.throws(() => Order.create('', 'cust-1', sampleItem), /ORDER_ID_REQUIRED/);
    assert.throws(() => Order.create('   ', 'cust-1', sampleItem), /ORDER_ID_REQUIRED/);
    assert.throws(() => Order.create('ord-1', '', sampleItem), /CUSTOMER_ID_REQUIRED/);
    assert.throws(() => Order.create('ord-1', '   ', sampleItem), /CUSTOMER_ID_REQUIRED/);
  });

  it('Order.create: Từ chối đơn hàng không có sản phẩm nào (EMPTY_ORDER_ITEMS)', () => {
    assert.throws(() => Order.create('ord-1', 'cust-1', []), /EMPTY_ORDER_ITEMS/);
  });

  it('Order.create: Invariant chống trùng lặp sản phẩm trong một đơn hàng (DUPLICATE_ORDER_ITEM)', () => {
    const duplicateItems = [
      { productId: 'prod-A', quantity: 2, unitPrice: 100 },
      { productId: 'prod-A', quantity: 3, unitPrice: 100 }, // Trùng lặp prod-A
    ];
    assert.throws(
      () => Order.create('ord-dup-test', 'cust-1', duplicateItems),
      /DUPLICATE_ORDER_ITEM/,
      'Order.create phải từ chối khi phát hiện trùng lặp productId'
    );
  });

  it('Order State Transitions: Ngăn cấm các bước chuyển trạng thái bất hợp lệ', () => {
    const items = [{ productId: 'p1', quantity: 1, unitPrice: 100 }];

    // Không thể confirm đơn đã CANCELLED
    const cancelledOrder = Order.create('ord-cancel-first', 'c1', items);
    cancelledOrder.cancel('Khách đổi ý');
    assert.equal(cancelledOrder.getStatus(), 'CANCELLED');
    assert.throws(() => cancelledOrder.confirm(), /INVALID_TRANSITION/);

    // Không thể cancel đơn đã CONFIRMED
    const confirmedOrder = Order.create('ord-confirm-first', 'c1', items);
    confirmedOrder.confirm();
    assert.equal(confirmedOrder.getStatus(), 'CONFIRMED');
    assert.throws(() => confirmedOrder.cancel('Muốn hủy đơn đã duyệt'), /INVALID_TRANSITION/);

    // Không thể confirm hai lần
    assert.throws(() => confirmedOrder.confirm(), /INVALID_TRANSITION/);
  });

  it('Domain Event: Đảm bảo tính bất biến hoàn toàn (Deep Immutability)', () => {
    const event = new OrderCreatedEvent('ord-immut', {
      customerId: 'c1',
      items: [{ productId: 'p1', quantity: 2, unitPrice: 50 }],
      totalAmount: 100,
      status: 'PENDING',
    });

    assert.ok(Object.isFrozen(event), 'Event root phải bị đóng băng');
    assert.ok(Object.isFrozen(event.payload), 'Payload phải bị đóng băng');

    // Cố tình sửa đổi thuộc tính gốc
    assert.throws(() => {
      // @ts-ignore
      event.orderId = 'hacked';
    }, TypeError);

    // Cố tình sửa đổi payload con
    assert.throws(() => {
      // @ts-ignore
      event.payload.totalAmount = 0;
    }, TypeError);
  });
});

describe('3. Kiểm thử điều kiện biên Application & Use Cases', () => {
  it('CreateOrderUseCase: Từ chối Command không hợp lệ và ném ApplicationError', async () => {
    const repo = new InMemoryOrderRepository();
    const useCase = new CreateOrderUseCase(repo);

    // Thiếu customerId
    await assert.rejects(
      async () => await useCase.execute({ customerId: '', items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }] }),
      OrderValidationError
    );

    // Items rỗng
    await assert.rejects(
      async () => await useCase.execute({ customerId: 'c1', items: [] }),
      OrderValidationError
    );

    // Trùng lặp orderId
    await useCase.execute({ orderId: 'ord-unique', customerId: 'c1', items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }] });
    await assert.rejects(
      async () => await useCase.execute({ orderId: 'ord-unique', customerId: 'c2', items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }] }),
      OrderAlreadyExistsError
    );
  });

  it('CreateOrderUseCase: Tự động Rollback trong Unit of Work khi cơ sở dữ liệu gặp lỗi', async () => {
    class FailingRepo extends InMemoryOrderRepository {
      async save() {
        throw new Error('DATABASE_CONNECTION_LOST');
      }
    }
    const uow = new InMemoryUnitOfWork();
    const useCase = new CreateOrderUseCase(new FailingRepo(), uow);

    await assert.rejects(
      async () =>
        await useCase.execute({
          customerId: 'c1',
          items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }],
        }),
      /DATABASE_CONNECTION_LOST/
    );

    assert.equal(uow.commitCount, 0, 'Không được commit');
    assert.equal(uow.rollbackCount, 1, 'Bắt buộc rollback');
  });

  it('GetOrderByIdQueryHandler: Truy vấn dữ liệu an toàn, không có side-effect (CQRS)', async () => {
    const repo = new InMemoryOrderRepository();
    const useCase = new CreateOrderUseCase(repo);
    await useCase.execute({
      orderId: 'ord-query-test',
      customerId: 'cust-1',
      items: [{ productId: 'p1', quantity: 3, unitPrice: 50 }],
    });

    const queryHandler = new GetOrderByIdQueryHandler(repo);
    const result1 = await queryHandler.execute({ orderId: 'ord-query-test' });
    const result2 = await queryHandler.execute({ orderId: 'ord-query-test' });

    assert.equal(result1?.id, 'ord-query-test');
    assert.equal(result2?.id, 'ord-query-test');
    assert.equal(repo.count(), 1, 'Số lượng bản ghi trong repo không thay đổi');

    // Query không tồn tại trả về null
    const notFound = await queryHandler.execute({ orderId: 'ord-unknown' });
    assert.equal(notFound, null);
  });
});

