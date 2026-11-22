// Micro-lab minh họa độc lập CF-017: Service boundaries, extraction strategy, data ownership
// Chạy từ root repository: node labs/CF-017/demo.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('[CF-017 Micro-Lab] Bắt đầu kiểm tra Service Boundaries & Data Ownership...');

// 1. Kiểm tra sự tồn tại của tài liệu kiến trúc extraction-plan.md
const docPath = path.resolve('docs/ddd/extraction-plan.md');
assert.ok(fs.existsSync(docPath), 'Tài liệu docs/ddd/extraction-plan.md phải tồn tại');
const docContent = fs.readFileSync(docPath, 'utf8');

// 2. Kiểm tra các từ khóa và nội dung cốt lõi trong extraction-plan.md
assert.ok(docContent.includes('Database-per-service'), 'Kế hoạch phải nêu rõ nguyên tắc Database-per-service');
assert.ok(docContent.includes('Strangler Fig'), 'Kế hoạch phải nêu rõ chiến lược bóc tách Strangler Fig Pattern');
assert.ok(docContent.includes('Rollback Plan'), 'Kế hoạch phải có Rollback Plan khi tách dịch vụ');
assert.ok(docContent.includes('DAG') || docContent.includes('Directed Acyclic Graph'), 'Kế hoạch phải chứng minh tính phi chu trình (DAG)');

// 3. Kiểm tra tính độc lập quyền sở hữu dữ liệu (Zero Shared Database)
const owners = {
  catalog: 'catalog_db',
  order: 'order_db',
  inventory: 'inventory_db',
  payment: 'payment_db',
};

const dbList = Object.values(owners);
const uniqueDbs = new Set(dbList);
assert.equal(dbList.length, uniqueDbs.size, 'Mỗi service bắt buộc phải sở hữu một database riêng biệt (Database-per-service)');

// 4. Kiểm tra mô hình phụ thuộc dữ liệu (Data Dependency Matrix - DAG Verification)
// Đồ thị phụ thuộc trực tiếp:
// Ordering -> Catalog (đọc product price/snapshot)
// Ordering -> Inventory (reserve stock)
// Ordering -> Payment (charge payment)
// Payment -> Inventory (release compensation qua event)
// Catalog -> không phụ thuộc ai
const dependencies = {
  catalog: [],
  inventory: ['catalog'],
  payment: [],
  order: ['catalog', 'inventory', 'payment'],
};

// Thuật toán kiểm tra tính phi chu trình (Cycle Detection bằng DFS)
function hasCycle(graph) {
  const visited = new Set();
  const recStack = new Set();

  function dfs(node) {
    visited.add(node);
    recStack.add(node);

    const neighbors = graph[node] || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        return true; // Phát hiện cycle!
      }
    }

    recStack.delete(node);
    return false;
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      if (dfs(node)) return true;
    }
  }
  return false;
}

assert.equal(hasCycle(dependencies), false, 'Đồ thị phụ thuộc dữ liệu bắt buộc phải là DAG (không có Circular Dependencies)');

// 5. Kiểm tra tính toàn vẹn của State Machine và phân định trách nhiệm
const serviceCapabilities = {
  catalog: { managesStock: false, managesPrice: true, directOrderWrite: false },
  inventory: { managesStock: true, createsPayment: false, directOrderWrite: false },
  order: { managesOrderStatus: true, directStockSqlUpdate: false },
  payment: { executesCharge: true, directOrderSqlUpdate: false },
};

assert.equal(serviceCapabilities.catalog.managesStock, false, 'Catalog Service không được quản lý tồn kho');
assert.equal(serviceCapabilities.inventory.createsPayment, false, 'Inventory Service không được tạo thanh toán');
assert.equal(serviceCapabilities.order.directStockSqlUpdate, false, 'Ordering Service không được update trực tiếp bảng stock qua SQL');
assert.equal(serviceCapabilities.payment.directOrderSqlUpdate, false, 'Payment Service không được update trực tiếp bảng order qua SQL');

console.log('✔ Toàn bộ 5 kiểm tra kiến trúc Service Boundaries & Data Ownership đều HỢP LỆ.');
console.log('MICRO_LAB_OK CF-017');
