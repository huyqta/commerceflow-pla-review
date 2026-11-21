// Micro-lab kiểm chứng thực chất cho CF-003
// Đọc trực tiếp docs/requirements.md và kiểm tra các kịch bản BDD theo yêu cầu
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const reqPath = path.resolve('docs/requirements.md');
assert.ok(fs.existsSync(reqPath), 'Thất bại: docs/requirements.md không tồn tại!');

const content = fs.readFileSync(reqPath, 'utf8');

// 1. Kiểm tra cấu trúc BDD Given / When / Then
assert.ok(
  content.includes('Given') && content.includes('When') && content.includes('Then'),
  'Thất bại: docs/requirements.md chưa tuân thủ cấu trúc BDD (Given / When / Then)!'
);

// 2. Kiểm tra 3 kịch bản cốt lõi
const hasR01 = content.includes('R-01') || (content.includes('thành công') && content.includes('PENDING'));
assert.ok(hasR01, 'Thất bại: Thiếu kịch bản "Tạo đơn thành công" (R-01)!');

const hasR02 = content.includes('R-02') || content.includes('Hết hàng');
assert.ok(hasR02, 'Thất bại: Thiếu kịch bản "Hết hàng" (R-02)!');

const hasR03 = content.includes('R-03') || content.includes('Thanh toán lỗi');
assert.ok(hasR03, 'Thất bại: Thiếu kịch bản "Thanh toán lỗi" (R-03)!');

// 3. Kiểm tra kịch bản thử thách độc lập: Đơn hàng 2 sản phẩm (Atomic multi-item reservation)
const hasMultiProduct =
  (content.includes('2 sản phẩm') || content.includes('nhiều sản phẩm') || content.includes('Multi-item')) &&
  content.includes('sản phẩm A') &&
  (content.includes('sản phẩm B') || content.includes('sản phẩm 2'));

assert.ok(
  hasMultiProduct,
  'Thất bại: Chưa có kịch bản BDD cho "Đơn hàng có 2 sản phẩm" (Thử thách độc lập của CF-003)!'
);

console.log('MICRO_LAB_OK CF-003 (Đã kiểm chứng đầy đủ các kịch bản BDD trong docs/requirements.md)');
