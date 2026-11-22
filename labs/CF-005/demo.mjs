// Micro-lab kiểm chứng thực chất cho CF-005
// Đọc trực tiếp docs/architecture.md và kiểm tra ADRs, Threat Model, Chi phí, NFRs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const archPath = path.resolve('docs/architecture.md');
assert.ok(fs.existsSync(archPath), 'Thất bại: docs/architecture.md không tồn tại!');

const content = fs.readFileSync(archPath, 'utf8');

// 1. Kiểm tra độ dài nội dung tài liệu
assert.ok(content.length > 500, 'Thất bại: docs/architecture.md quá ngắn hoặc chưa có phân tích chi tiết!');

// 2. Kiểm tra chiến lược Modular Monolith First và liên kết ADR
assert.ok(
  content.toLowerCase().includes('modular monolith') && content.includes('ADR'),
  'Thất bại: Thiếu phân tích chiến lược "Modular Monolith First" hoặc liên kết ADR trong docs/architecture.md!'
);

// 3. Kiểm tra phân tích rủi ro dữ liệu (Data consistency / dual-write)
assert.ok(
  content.toLowerCase().includes('dual-write') || content.toLowerCase().includes('outbox') || content.includes('nhất quán'),
  'Thất bại: Thiếu phân tích rủi ro dữ liệu (Dual-write / Outbox / Data consistency)!'
);

// 4. Kiểm tra Threat Model & IAM Least Privilege
assert.ok(
  (content.includes('Threat Model') || content.includes('STRIDE') || content.includes('Bảo mật')) &&
  (content.includes('IAM') || content.includes('Least Privilege')),
  'Thất bại: Thiếu phân tích mô hình đe dọa (Threat Model) hoặc kiểm soát IAM Least Privilege!'
);

// 5. Kiểm tra rủi ro chi phí & ngân sách Cloud ($50 budget / Cloud Run scale-to-zero)
assert.ok(
  (content.includes('50') || content.includes('ngân sách') || content.includes('budget')) &&
  content.includes('Cloud Run'),
  'Thất bại: Thiếu phân tích rủi ro chi phí và ngân sách GCP ($50/tháng)!'
);

// 6. Kiểm tra hai trường hợp không nên tách service (Thử thách độc lập của CF-005)
assert.ok(
  content.includes('không nên tách') || content.includes('không tách service'),
  'Thất bại: Chưa phân tích "Hai trường hợp không nên tách service" (Thử thách độc lập của CF-005)!'
);

console.log('MICRO_LAB_OK CF-005 (Đã kiểm chứng thực tế docs/architecture.md thành công)');
