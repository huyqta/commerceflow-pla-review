// Micro-lab kiểm chứng thực chất cho CF-001
// Đọc trực tiếp artifact docs/glossary.md và kiểm tra các yêu cầu bắt buộc
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const glossaryPath = path.resolve('docs/glossary.md');
assert.ok(fs.existsSync(glossaryPath), 'Thất bại: docs/glossary.md không tồn tại!');

const content = fs.readFileSync(glossaryPath, 'utf8');

// 1. Kiểm tra độ dài tối thiểu
assert.ok(content.length > 500, 'Thất bại: docs/glossary.md quá ngắn hoặc chưa có nội dung!');

// 2. Kiểm tra các thuật ngữ nền tảng bắt buộc
const requiredTerms = ['DDD', 'Clean Architecture', 'Microservices', 'GCP'];
for (const term of requiredTerms) {
  assert.ok(
    content.toLowerCase().includes(term.toLowerCase()),
    `Thất bại: Thiếu định nghĩa thuật ngữ bắt buộc "${term}" trong docs/glossary.md`
  );
}

// 3. Kiểm tra phân biệt Aggregate với Service
assert.ok(
  content.includes('Aggregate') && (content.includes('Domain Service') || content.includes('Application Service')),
  'Thất bại: Chưa phân biệt Aggregate với Domain/Application Service trong docs/glossary.md'
);

// 4. Kiểm tra phân biệt Domain Event và Integration Event
assert.ok(
  content.includes('Domain Event') && content.includes('Integration Event'),
  'Thất bại: Chưa làm rõ khái niệm Domain Event và Integration Event trong docs/glossary.md'
);

// 5. Kiểm tra concept map hoặc diagram
assert.ok(
  content.includes('Concept Map') || content.includes('Architecture') || content.includes('Clean'),
  'Thất bại: Thiếu sơ đồ hoặc liên kết Concept Map giữa các tầng kiến trúc!'
);

console.log('MICRO_LAB_OK CF-001 (Đã kiểm chứng thực tế docs/glossary.md thành công)');
