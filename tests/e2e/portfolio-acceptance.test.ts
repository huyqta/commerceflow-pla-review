import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('CF-040: Final Acceptance, Clean-Room Reproduction & Portfolio', () => {
  const rootDir = process.cwd();
  const portfolioPath = path.join(rootDir, 'docs', 'portfolio.md');
  const microLabPath = path.join(rootDir, 'labs', 'CF-040', 'demo.mjs');

  it('1. docs/portfolio.md phải tồn tại và định nghĩa đủ 5 Acceptance Quality Gates', () => {
    assert.ok(fs.existsSync(portfolioPath), 'docs/portfolio.md must exist');
    const content = fs.readFileSync(portfolioPath, 'utf8');

    // Các gates định nghĩa trong labs/CF-040/demo.mjs:
    // ['domain', 'local-demo', 'ci', 'cloud-demo', 'cleanup']
    const expectedGates = ['domain', 'local-demo', 'ci', 'cloud-demo', 'cleanup'];
    for (const gate of expectedGates) {
      assert.ok(
        content.includes(`\`${gate}\``),
        `docs/portfolio.md must document gate: ${gate}`
      );
    }
  });

  it('2. Traceability Matrix phải map đầy đủ requirements R-01 đến R-06 với test suite & evidence', () => {
    const content = fs.readFileSync(portfolioPath, 'utf8');
    const requiredCodes = ['R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'R-06'];

    for (const code of requiredCodes) {
      assert.ok(
        content.includes(`**${code}**`),
        `docs/portfolio.md must map requirement ${code}`
      );
    }

    // Xác nhận có tham chiếu tới test suites chủ đạo
    assert.ok(content.includes('order-saga.test.ts'));
    assert.ok(content.includes('outbox-inbox.test.ts'));
  });

  it('3. Fresh Clone Walkthrough phải cung cấp đầy đủ các bước tái lập từ mã nguồn sạch', () => {
    const content = fs.readFileSync(portfolioPath, 'utf8');

    assert.ok(content.includes('npm install'), 'Phải hướng dẫn cài đặt dependencies');
    assert.ok(content.includes('npm test'), 'Phải hướng dẫn chạy toàn bộ test suite');
    assert.ok(content.includes('docker compose up'), 'Phải hướng dẫn khởi chạy local stack');
    assert.ok(content.includes('docker compose down -v'), 'Phải hướng dẫn dọn dẹp tài nguyên (cleanup gate)');
  });

  it('4. Kịch bản Thuyết trình 5 phút phải giải trình các quyết định kiến trúc cốt lõi', () => {
    const content = fs.readFileSync(portfolioPath, 'utf8');

    assert.ok(content.includes('Domain-Driven Design'), 'Phải giải thích DDD');
    assert.ok(content.includes('Strangler Fig Pattern'), 'Phải giải thích chiến lược bóc tách');
    assert.ok(content.includes('Saga Compensation'), 'Phải giải thích Saga bồi hoàn');
    assert.ok(content.includes('Cloud Run'), 'Phải giải thích lý do chọn Cloud Run vs GKE');
    assert.ok(content.includes('Tested Restore'), 'Phải giải thích Backup vs Tested Restore Illusion');
  });

  it('5. Thử thách độc lập: Phải có ví dụ cụ thể và phép thử kiểm chứng bồi hoàn kho khi thanh toán lỗi', () => {
    const content = fs.readFileSync(portfolioPath, 'utf8');

    assert.ok(content.includes('PAYMENT_GATEWAY_TIMEOUT') || content.includes('Payment Simulator trả FAILED'));
    assert.ok(content.includes('tests/order/order-saga.test.ts'));
  });

  it('6. Negative Case: Trình thẩm định phát hiện và từ chối khi thiếu Gate hoặc claim chưa kiểm chứng', () => {
    // Giả lập hàm thẩm định Quality Gates
    function validateAcceptanceGates(gates: string[]): { valid: boolean; missingGates: string[] } {
      const requiredGates = ['domain', 'local-demo', 'ci', 'cloud-demo', 'cleanup'];
      const missing = requiredGates.filter(g => !gates.includes(g));
      return {
        valid: missing.length === 0,
        missingGates: missing
      };
    }

    // Trường hợp 1: Đầy đủ gates -> Hợp lệ
    const validRun = validateAcceptanceGates(['domain', 'local-demo', 'ci', 'cloud-demo', 'cleanup']);
    assert.equal(validRun.valid, true);
    assert.equal(validRun.missingGates.length, 0);

    // Trường hợp 2: Thiếu gate 'cleanup' -> Bị từ chối
    const missingCleanup = validateAcceptanceGates(['domain', 'local-demo', 'ci', 'cloud-demo']);
    assert.equal(missingCleanup.valid, false);
    assert.deepEqual(missingCleanup.missingGates, ['cleanup']);

    // Trường hợp 3: Bỏ qua test evidence -> Từ chối claim 'production-ready'
    function verifyProductionReadiness(claims: { feature: string; evidencePath?: string }[]): boolean {
      return claims.every(c => typeof c.evidencePath === 'string' && c.evidencePath.length > 0);
    }

    const unverifiedClaims = [
      { feature: 'Core Saga', evidencePath: 'evidence/CF-022/README.md' },
      { feature: 'Disaster Recovery', evidencePath: undefined } // Thiếu evidence
    ];
    assert.equal(verifyProductionReadiness(unverifiedClaims), false, 'Phải từ chối khi có claim chưa kiểm chứng');
  });
});

