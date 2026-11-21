// Micro-lab kiểm chứng thực chất cho CF-002
// Kiểm tra môi trường thực tế, artifact docs/environment.md và chạy starter tests
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// 1. Kiểm tra môi trường Node hiện tại
const nodeMajor = Number(process.versions.node.split('.')[0]);
assert.ok(nodeMajor >= 20, `Thất bại: Node.js phải >= 20 (hiện tại: ${process.versions.node})`);

// 2. Kiểm tra artifact docs/environment.md
const envDocPath = path.resolve('docs/environment.md');
assert.ok(fs.existsSync(envDocPath), 'Thất bại: docs/environment.md không tồn tại!');
const envContent = fs.readFileSync(envDocPath, 'utf8');

const requiredTools = ['Node', 'Git', 'Docker', 'pnpm'];
for (const tool of requiredTools) {
  assert.ok(
    envContent.toLowerCase().includes(tool.toLowerCase()),
    `Thất bại: docs/environment.md chưa ghi nhận cấu hình/phiên bản của "${tool}"`
  );
}

// 3. Thực thi trực tiếp starter tests để đảm bảo domain tests pass thật
try {
  const testOutput = execSync('node --experimental-strip-types --test starter/tests/*.test.ts', {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.ok(testOutput.includes('pass 3') || testOutput.includes('pass'), 'Starter tests không pass!');
} catch (error) {
  assert.fail(`Thất bại: Starter domain tests bị lỗi!\n${error.stderr || error.stdout}`);
}

console.log('MICRO_LAB_OK CF-002 (Đã kiểm chứng môi trường thực tế & starter tests thành công)');
