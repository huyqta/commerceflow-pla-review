import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('CF-033: GCP Sandbox, Budgets, IAM & Network Boundaries', () => {
  const sandboxDocPath = path.resolve('docs/deployment/gcp-sandbox.md');

  it('xác minh tài liệu docs/deployment/gcp-sandbox.md tồn tại và chứa đầy đủ nội dung chuẩn', () => {
    assert.ok(fs.existsSync(sandboxDocPath), 'docs/deployment/gcp-sandbox.md phải tồn tại');
    const content = fs.readFileSync(sandboxDocPath, 'utf8');

    // Kiểm tra các nội dung trọng tâm
    assert.ok(content.includes('GCP Sandbox, Quản lý Ngân sách, IAM và Ranh giới Mạng'), 'Thiếu tiêu đề chính');
    assert.ok(content.includes('Ranh giới Mạng Bảo mật'), 'Thiếu ranh giới mạng');
    assert.ok(content.includes('Dự toán Chi phí & Chính sách Ngân sách'), 'Thiếu dự toán chi phí');
    assert.ok(content.includes('Thử thách Độc lập: Bảng Kê Khai Tài nguyên'), 'Thiếu Resource Inventory Table');
    assert.ok(content.includes('Budget Alert KHÔNG Tự Chặn Chi Tiêu'), 'Thiếu phân tích trade-off');
  });

  it('xác thực công thức tính toán ngưỡng cảnh báo ngân sách (khớp micro-lab)', () => {
    const monthlyBudget = 50;
    const threshold = [0.25, 0.5, 0.8, 1.0];
    const expectedTriggers = [12.5, 25.0, 40.0, 50.0];

    const calculated = threshold.map(x => x * monthlyBudget);
    assert.deepEqual(calculated, expectedTriggers, 'Ngưỡng ngân sách tính toán phải khớp hoàn toàn');
  });

  it('thử thách độc lập: kiểm tra cấu trúc bảng kê khai tài nguyên (Resource Inventory) & vòng đời dọn dẹp', () => {
    interface ResourceInventoryItem {
      id: string;
      type: string;
      businessPurpose: string;
      teardownPlan: string;
      hasPublicIp: boolean;
    }

    const inventory: ResourceInventoryItem[] = [
      {
        id: 'vpc-sandbox-01',
        type: 'google_compute_network',
        businessPurpose: 'VPC network isolation',
        teardownPlan: 'retain_config',
        hasPublicIp: false
      },
      {
        id: 'gke-sandbox-cluster',
        type: 'google_container_cluster',
        businessPurpose: 'Microservices container runtime',
        teardownPlan: 'immediate_destroy_after_demo',
        hasPublicIp: false // Private GKE cluster
      },
      {
        id: 'sql-sandbox-pg',
        type: 'google_sql_database_instance',
        businessPurpose: 'PostgreSQL database',
        teardownPlan: 'snapshot_and_destroy',
        hasPublicIp: false // Private IP only
      }
    ];

    // Invariant: Các tài nguyên nội bộ lõi TUYỆT ĐỐI không có Public IP
    for (const item of inventory) {
      assert.equal(item.hasPublicIp, false, `Tài nguyên ${item.id} không được phép mở Public IP trực tiếp`);
      assert.ok(item.teardownPlan.length > 0, `Tài nguyên ${item.id} phải có kịch bản dọn dẹp`);
    }
  });

  it('negative case: phát hiện và kích hoạt automated kill-switch khi ngân sách vượt ngưỡng 100%', () => {
    interface BillingStatus {
      currentSpending: number;
      budgetLimit: number;
      alertTriggered: boolean;
      killSwitchActivated: boolean;
    }

    function evaluateBudget(spending: number, limit: number): BillingStatus {
      const status: BillingStatus = {
        currentSpending: spending,
        budgetLimit: limit,
        alertTriggered: false,
        killSwitchActivated: false
      };

      if (spending >= limit * 0.8) {
        status.alertTriggered = true;
      }
      if (spending >= limit) {
        // Trade-off mitigation: Tự động ngắt billing/tắt cluster khi chạm 100%
        status.killSwitchActivated = true;
      }
      return status;
    }

    // Tình huống bình thường ($30 / $50)
    const normalState = evaluateBudget(30, 50);
    assert.equal(normalState.alertTriggered, false);
    assert.equal(normalState.killSwitchActivated, false);

    // Tình huống chạm 80% ($42 / $50)
    const warningState = evaluateBudget(42, 50);
    assert.equal(warningState.alertTriggered, true);
    assert.equal(warningState.killSwitchActivated, false);

    // Negative boundary: Vượt 100% ngân sách do tấn công / lỗi lặp ($55 / $50)
    const overspentState = evaluateBudget(55, 50);
    assert.equal(overspentState.alertTriggered, true);
    assert.equal(overspentState.killSwitchActivated, true, 'Kill-switch phải được kích hoạt để chặn phát sinh chi phí');
  });
});

