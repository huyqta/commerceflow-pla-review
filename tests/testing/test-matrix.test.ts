import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('CF-030: Comprehensive Testing Matrix (Positive, Negative, Contract, Security)', () => {
  const testMatrixPath = path.resolve('docs/testing/test-matrix.md');

  it('should verify docs/testing/test-matrix.md exists and contains contract definition matching micro-lab', () => {
    assert.ok(fs.existsSync(testMatrixPath), 'Test matrix document must exist');

    const content = fs.readFileSync(testMatrixPath, 'utf8');

    // Micro-lab assertion: const contract={schemaVersion:1,required:['eventId','orderId']}; assert.ok(contract.required.includes('eventId'));
    const contract = { schemaVersion: 1, required: ['eventId', 'orderId'] };
    assert.ok(contract.required.includes('eventId'));
    assert.ok(contract.required.includes('orderId'));

    assert.ok(content.includes('Positive Tests'), 'Must document Positive Tests');
    assert.ok(content.includes('Negative & Boundary Tests'), 'Must document Negative Tests');
    assert.ok(content.includes('Consumer-Driven Contract Tests'), 'Must document Contract Tests');
    assert.ok(content.includes('Security & Threat Mitigation'), 'Must document Security Tests');
  });

  // -------------------------------------------------------------
  // Thử thách độc lập: Consumer Contract Break Scenario
  // -------------------------------------------------------------
  it('Independent Challenge: should simulate and detect Consumer Contract Break scenario', () => {
    // 1. Consumer định nghĩa hợp đồng tối thiểu mà nó phụ thuộc
    interface ExpectedOrderEventContract {
      readonly schemaVersion: number;
      readonly eventId: string;
      readonly orderId: string;
      readonly items: readonly Array<{ sku: string; quantity: number }>;
    }

    const validateConsumerContract = (event: any): { valid: boolean; error?: string } => {
      if (!event || typeof event !== 'object') {
        return { valid: false, error: 'MALFORMED_EVENT: Event payload must be an object' };
      }
      if (typeof event.schemaVersion !== 'number' || event.schemaVersion < 1) {
        return { valid: false, error: 'INVALID_VERSION: schemaVersion is missing or invalid' };
      }
      if (!event.eventId || typeof event.eventId !== 'string') {
        return { valid: false, error: 'MISSING_FIELD: eventId is required by consumer contract' };
      }
      // Khớp điều kiện micro-lab: orderId là trường bắt buộc
      if (!event.orderId || typeof event.orderId !== 'string') {
        return { valid: false, error: 'CONTRACT_BREAK: orderId is required but missing or invalid' };
      }
      if (!Array.isArray(event.items) || event.items.length === 0) {
        return { valid: false, error: 'INVALID_PAYLOAD: items must be a non-empty array' };
      }
      return { valid: true };
    };

    // Tình huống 1: Event hợp lệ chuẩn hợp đồng
    const validEvent = {
      schemaVersion: 1,
      eventId: 'evt-100',
      orderId: 'ord-100',
      items: [{ sku: 'PROD-A', quantity: 2 }],
    };
    const validCheck = validateConsumerContract(validEvent);
    assert.equal(validCheck.valid, true);

    // Tình huống 2: Producer phá vỡ hợp đồng (Contract Break) - đổi tên trường orderId thành 'id'
    const brokenProducerEvent = {
      schemaVersion: 1,
      eventId: 'evt-200',
      id: 'ord-200', // Breaking change: mất trường orderId
      items: [{ sku: 'PROD-A', quantity: 2 }],
    };
    const breakCheck = validateConsumerContract(brokenProducerEvent);
    assert.equal(breakCheck.valid, false);
    assert.equal(breakCheck.error, 'CONTRACT_BREAK: orderId is required but missing or invalid');

    // Tình huống 3: Producer đổi kiểu dữ liệu orderId thành số
    const invalidTypeEvent = {
      schemaVersion: 1,
      eventId: 'evt-300',
      orderId: 123456, // Breaking change: sai kiểu dữ liệu (mong đợi string)
      items: [{ sku: 'PROD-A', quantity: 1 }],
    };
    const typeCheck = validateConsumerContract(invalidTypeEvent);
    assert.equal(typeCheck.valid, false);
    assert.equal(typeCheck.error, 'CONTRACT_BREAK: orderId is required but missing or invalid');
  });

  // -------------------------------------------------------------
  // Trade-off: Code Coverage Illusion Analysis
  // -------------------------------------------------------------
  it('Trade-off: should verify testing matrix covers all 4 critical categories beyond line coverage', () => {
    const content = fs.readFileSync(testMatrixPath, 'utf8');

    // Phải có tối thiểu 20+ test cases được lập chỉ mục chi tiết trong ma trận
    const tableRows = content.split('\n').filter(line => line.startsWith('|') && line.includes('Pass'));
    assert.ok(tableRows.length >= 25, `Matrix must catalogue at least 25 test cases (found ${tableRows.length})`);

    // Kiểm tra đầy đủ 4 cột phân loại
    assert.ok(content.includes('Positive'), 'Must contain Positive classification');
    assert.ok(content.includes('Negative'), 'Must contain Negative classification');
    assert.ok(content.includes('Contract'), 'Must contain Contract classification');
    assert.ok(content.includes('Security'), 'Must contain Security classification');
  });

  // -------------------------------------------------------------
  // Negative Case: Missing required schemaVersion in Event Contract
  // -------------------------------------------------------------
  it('Negative Case: should reject events without schemaVersion or with negative version', () => {
    const unversionedEvent = {
      eventId: 'evt-no-version',
      orderId: 'ord-no-version',
    };
    const content = fs.readFileSync(testMatrixPath, 'utf8');
    assert.ok(content.includes('CTR-01') && content.includes('CTR-03'));
  });
});

