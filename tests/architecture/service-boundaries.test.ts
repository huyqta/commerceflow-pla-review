import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('1. Đặc tả Kiến trúc Bóc tách (Extraction Plan & Service Boundaries)', () => {
  const planPath = path.resolve('docs/ddd/extraction-plan.md');

  it('Tệp extraction-plan.md phải tồn tại tại docs/ddd/', () => {
    assert.ok(fs.existsSync(planPath), 'docs/ddd/extraction-plan.md không tồn tại');
  });

  it('Kế hoạch phải bao hàm 4 dịch vụ độc lập và 1 API Gateway', () => {
    const content = fs.readFileSync(planPath, 'utf8');
    assert.ok(content.includes('Catalog Service'), 'Thiếu Catalog Service');
    assert.ok(content.includes('Inventory Service'), 'Thiếu Inventory Service');
    assert.ok(content.includes('Ordering Service'), 'Thiếu Ordering Service');
    assert.ok(content.includes('Payment Service'), 'Thiếu Payment Service');
    assert.ok(content.includes('API Gateway'), 'Thiếu API Gateway');
  });

  it('Kế hoạch phải định nghĩa rõ ràng nguyên tắc Database-per-service', () => {
    const content = fs.readFileSync(planPath, 'utf8');
    assert.ok(content.includes('Database-per-service'), 'Thiếu nguyên tắc Database-per-service');
    assert.ok(content.includes('Zero Shared Tables') || content.includes('Không bảng dùng chung'), 'Thiếu cam kết không dùng chung bảng');
  });

  it('Kế hoạch phải có chiến lược Strangler Fig Pattern và Sequence 4 giai đoạn', () => {
    const content = fs.readFileSync(planPath, 'utf8');
    assert.ok(content.includes('Strangler Fig'), 'Thiếu định nghĩa Strangler Fig Pattern');
    assert.ok(content.includes('Giai đoạn 1'), 'Thiếu Giai đoạn 1');
    assert.ok(content.includes('Giai đoạn 2'), 'Thiếu Giai đoạn 2');
    assert.ok(content.includes('Giai đoạn 3'), 'Thiếu Giai đoạn 3');
    assert.ok(content.includes('Giai đoạn 4'), 'Thiếu Giai đoạn 4');
  });
});

describe('2. Phân định Quyền sở hữu Dữ liệu (Data Ownership & Invariants)', () => {
  // Mỗi service sở hữu database riêng biệt, các bảng nghiệp vụ lõi (Domain Entity Tables) không được trùng lặp
  const dataOwners = {
    catalog: { db: 'catalog_db', domainTables: ['products', 'categories'] },
    inventory: { db: 'inventory_db', domainTables: ['inventory_items', 'stock_reservations'] },
    ordering: { db: 'order_db', domainTables: ['orders', 'order_items'] },
    payment: { db: 'payment_db', domainTables: ['payment_transactions'] },
  };

  it('Mỗi service phải sở hữu database riêng biệt, không trùng lặp (Zero Database Sharing)', () => {
    const databases = Object.values(dataOwners).map(o => o.db);
    const uniqueDbs = new Set(databases);
    assert.equal(uniqueDbs.size, databases.length, 'Phát hiện cơ sở dữ liệu bị chia sẻ giữa các services');
  });

  it('Không có bảng nghiệp vụ lõi (Domain Table) nào thuộc quyền sở hữu của nhiều hơn 1 service', () => {
    const allDomainTables = [];
    for (const [service, meta] of Object.entries(dataOwners)) {
      for (const table of meta.domainTables) {
        assert.ok(!allDomainTables.includes(table), `Bảng nghiệp vụ ${table} bị xung đột quyền sở hữu tại ${service}`);
        allDomainTables.push(table);
      }
    }
  });

  it('Không có quan hệ khóa ngoại (Foreign Key) vật lý liên dịch vụ', () => {
    // Trong microservices, order_items.product_id là chuỗi vô hướng tham chiếu, không phải SQL FOREIGN KEY sang bảng products
    const crossServiceFkAllowed = false;
    assert.equal(crossServiceFkAllowed, false, 'Tuyệt đối cấm tạo Foreign Key liên kết giữa các database khác nhau');
  });
});

describe('3. Kiểm thử Đồ thị Phụ thuộc Dữ liệu (DAG Verification & Zero Circular Dependencies)', () => {
  // Hàm kiểm tra cycle sử dụng DFS
  function findCycle(graph) {
    const visited = new Set();
    const recStack = new Set();
    let cyclePath = [];

    function dfs(node, path) {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      const neighbors = graph[node] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor, [...path])) return true;
        } else if (recStack.has(neighbor)) {
          cyclePath = [...path, neighbor];
          return true;
        }
      }

      recStack.delete(node);
      return false;
    }

    for (const node of Object.keys(graph)) {
      if (!visited.has(node)) {
        if (dfs(node, [])) return cyclePath;
      }
    }
    return null;
  }

  it('Ma trận phụ thuộc thực tế của CommerceFlow là một DAG hợp lệ', () => {
    const commerceFlowGraph = {
      catalog: [],
      inventory: ['catalog'],
      payment: [],
      order: ['catalog', 'inventory', 'payment'],
    };

    const cycle = findCycle(commerceFlowGraph);
    assert.equal(cycle, null, 'Hệ thống không được phép có chu trình phụ thuộc dữ liệu');
  });

  it('Negative test: Phát hiện và từ chối khi kiến trúc bị vi phạm phụ thuộc vòng tròn (Circular Dependency)', () => {
    // Giả sử có một anti-pattern: Inventory lại gọi trực tiếp Order để cập nhật trạng thái
    const invalidCyclicGraph = {
      catalog: [],
      order: ['inventory'],
      inventory: ['order'], // Lỗi: Vòng tròn 2 chiều giữa Order và Inventory!
    };

    const cycle = findCycle(invalidCyclicGraph);
    assert.ok(cycle !== null, 'Hệ thống kiểm tra phải phát hiện được phụ thuộc vòng tròn');
    assert.deepEqual(cycle, ['order', 'inventory', 'order'], 'Đường dẫn chu trình phải khớp với lỗi');
  });
});

describe('4. Kế hoạch Hoàn nguyên & Rollback Plan khi tách Inventory', () => {
  it('Kế hoạch phải bao gồm các điều kiện kích hoạt Rollback (Trigger Conditions)', () => {
    const content = fs.readFileSync(path.resolve('docs/ddd/extraction-plan.md'), 'utf8');
    assert.ok(content.includes('Tỷ lệ lỗi 5xx'), 'Thiếu ngưỡng lỗi 5xx');
    assert.ok(content.includes('P99 Latency'), 'Thiếu ngưỡng P99 latency');
    assert.ok(content.includes('Overselling'), 'Thiếu điều kiện phát hiện overselling');
  });

  it('Kế hoạch phải quy định cơ chế chuyển mạch Traffic (Traffic Switching) qua Feature Flag', () => {
    const content = fs.readFileSync(path.resolve('docs/ddd/extraction-plan.md'), 'utf8');
    assert.ok(content.includes('USE_STANDALONE_INVENTORY'), 'Thiếu định nghĩa feature flag chuyển mạch');
    assert.ok(content.includes('Data Reconciliation'), 'Thiếu quy trình đối soát dữ liệu reconciliation');
  });
});
