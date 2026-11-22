import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('CF-038: Observability, Tracing, Metrics, Logs & Alerts Runbook', () => {
  const runbookPath = path.resolve('docs/runbook.md');

  it('xác minh tài liệu docs/runbook.md tồn tại và chứa đầy đủ các phân mục SRE chuẩn', () => {
    assert.ok(fs.existsSync(runbookPath), 'runbook.md phải tồn tại');
    const content = fs.readFileSync(runbookPath, 'utf8');

    // Kiểm tra các nội dung trọng tâm
    assert.ok(content.includes('Production Runbook & SRE Observability Guide'), 'Thiếu tiêu đề chính');
    assert.ok(content.includes('Distributed Tracing with Correlation ID'), 'Thiếu phần tracing correlation ID');
    assert.ok(content.includes('SLI / SLO / SLA'), 'Thiếu các chỉ số SLI/SLO');
    assert.ok(content.includes('Alert Fatigue Mitigation') || content.includes('Anti-Noise Alert'), 'Thiếu thiết kế alert chống nhiễu');
    assert.ok(content.includes('PII Masking Sanitizer') || content.includes('PII / Token Leaking'), 'Thiếu phân tích trade-off bảo mật log');
  });

  it('xác thực định dạng correlation ID khớp micro-lab', () => {
    // Micro-lab assertion: const correlationId='trace-order-o1'; assert.ok(correlationId.startsWith('trace-'));
    const correlationId = 'trace-order-o1';
    assert.ok(correlationId.startsWith('trace-'), 'Correlation ID phải bắt đầu bằng trace-');
    assert.match(correlationId, /^trace-[a-z0-9-]+$/);
  });

  it('thử thách độc lập: mô phỏng thuật toán đánh giá Alert chống nhiễu (Anti-Noise Evaluation)', () => {
    interface RequestSampleWindow {
      totalRequests: number;
      error5xxCount: number;
      durationMinutes: number;
    }

    // Tiêu chuẩn alert: Tỷ lệ lỗi 5xx > 2% duy trì liên tục trong >= 3 phút VÀ tổng request >= 100
    function evaluateAlertRule(window: RequestSampleWindow): { shouldAlert: boolean; errorRate: number; reason: string } {
      if (window.totalRequests < 100) {
        return {
          shouldAlert: false,
          errorRate: window.totalRequests === 0 ? 0 : window.error5xxCount / window.totalRequests,
          reason: 'IGNORED_LOW_TRAFFIC: Không cảnh báo khi lưu lượng quá nhỏ (< 100 requests) để tránh báo động giả'
        };
      }

      const rate = window.error5xxCount / window.totalRequests;
      if (rate > 0.02 && window.durationMinutes >= 3) {
        return {
          shouldAlert: true,
          errorRate: rate,
          reason: 'ALERT_TRIGGERED: Tỷ lệ lỗi 5xx vượt 2% duy trì liên tục hơn 3 phút'
        };
      }

      return {
        shouldAlert: false,
        errorRate: rate,
        reason: 'WITHIN_THRESHOLD: Tỷ lệ lỗi hoặc thời gian duy trì chưa chạm ngưỡng nguy hiểm'
      };
    }

    // Tình huống 1: Chỉ có 2 request lỗi trong lúc rảnh rỗi (2 lỗi / 5 request = 40% lỗi, nhưng N=5)
    // Quy tắc thông minh KHÔNG ĐƯỢC báo động giả
    const spikeInIdle = evaluateAlertRule({ totalRequests: 5, error5xxCount: 2, durationMinutes: 1 });
    assert.equal(spikeInIdle.shouldAlert, false);
    assert.ok(spikeInIdle.reason.includes('IGNORED_LOW_TRAFFIC'));

    // Tình huống 2: Lỗi thoáng qua trong 1 phút (10 lỗi / 200 request = 5% lỗi, nhưng duy trì 1 phút) -> Không alert
    const transientSpike = evaluateAlertRule({ totalRequests: 200, error5xxCount: 10, durationMinutes: 1 });
    assert.equal(transientSpike.shouldAlert, false);

    // Tình huống 3: Sự cố nghiêm trọng kéo dài (15 lỗi / 300 request = 5% lỗi, duy trì 4 phút) -> BẬT ALERT
    const realIncident = evaluateAlertRule({ totalRequests: 300, error5xxCount: 15, durationMinutes: 4 });
    assert.equal(realIncident.shouldAlert, true);
    assert.ok(realIncident.reason.includes('ALERT_TRIGGERED'));
  });

  it('negative case: kiểm tra bộ lọc dữ liệu nhạy cảm chống rò rỉ PII và Token trong logs (Trade-off)', () => {
    const sensitivePayload = {
      orderId: 'ORD-12345',
      correlationId: 'trace-order-12345',
      customer: {
        name: 'Nguyen Van A',
        email: 'customer@example.com',
        password: 'SuperSecretPassword123!',
        cardNumber: '4111222233334444',
        cvv: '123'
      },
      headers: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz'
      }
    };

    const SENSITIVE_KEYS = ['password', 'token', 'authorization', 'secret', 'cardnumber', 'cvv'];

    function sanitizeLogData(obj: any): any {
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(sanitizeLogData);
      }
      const cleaned: Record<string, any> = {};
      for (const [key, val] of Object.entries(obj)) {
        if (SENSITIVE_KEYS.some(s => key.toLowerCase().includes(s))) {
          cleaned[key] = '[REDACTED]';
        } else if (typeof val === 'object' && val !== null) {
          cleaned[key] = sanitizeLogData(val);
        } else {
          cleaned[key] = val;
        }
      }
      return cleaned;
    }

    const sanitized = sanitizeLogData(sensitivePayload);

    // Dữ liệu an toàn được giữ lại
    assert.equal(sanitized.orderId, 'ORD-12345');
    assert.equal(sanitized.correlationId, 'trace-order-12345');

    // Dữ liệu nhạy cảm BẮT BUỘC phải được mask thành [REDACTED]
    assert.equal(sanitized.customer.password, '[REDACTED]');
    assert.equal(sanitized.customer.cardNumber, '[REDACTED]');
    assert.equal(sanitized.customer.cvv, '[REDACTED]');
    assert.equal(sanitized.headers.authorization, '[REDACTED]');
  });
});

