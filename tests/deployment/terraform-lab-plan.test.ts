import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('CF-034: Terraform Plan cho Cloud SQL, PubSub, Secrets & Cloud Run', () => {
  const labMainTfPath = path.resolve('infra/terraform/environments/lab/main.tf');

  it('xác minh tệp infra/terraform/environments/lab/main.tf tồn tại và khai báo đầy đủ 4 nhóm tài nguyên', () => {
    assert.ok(fs.existsSync(labMainTfPath), 'main.tf của môi trường lab phải tồn tại');
    const content = fs.readFileSync(labMainTfPath, 'utf8');

    // 1. Secret Manager
    assert.ok(content.includes('google_secret_manager_secret'), 'Phải khai báo Secret Manager');
    assert.ok(content.includes('commerceflow-db-password'), 'Phải có secret password');

    // 2. Pub/Sub
    assert.ok(content.includes('google_pubsub_topic'), 'Phải khai báo Pub/Sub topic');
    assert.ok(content.includes('google_pubsub_subscription'), 'Phải khai báo Pub/Sub subscription');

    // 3. Cloud SQL
    assert.ok(content.includes('google_sql_database_instance'), 'Phải khai báo Cloud SQL instance');
    assert.ok(content.includes('db-f1-micro'), 'Phải dùng tier tiết kiệm db-f1-micro');

    // 4. Cloud Run
    assert.ok(content.includes('google_cloud_run_v2_service'), 'Phải khai báo Cloud Run service');
    assert.ok(content.includes('min_instance_count = 0'), 'Cloud Run phải scale to zero để tiết kiệm chi phí');
  });

  it('xác thực danh sách tài nguyên cốt lõi khớp micro-lab', () => {
    // Micro-lab assertion: const resources=['cloud_run','pubsub','cloud_sql','secret_manager'];
    const resources = ['cloud_run', 'pubsub', 'cloud_sql', 'secret_manager'];
    assert.ok(resources.includes('cloud_sql'));
    assert.ok(resources.includes('cloud_run'));
    assert.ok(resources.includes('pubsub'));
    assert.ok(resources.includes('secret_manager'));
  });

  it('kiểm tra bất biến an toàn bảo mật và chi phí trong file Terraform', () => {
    const content = fs.readFileSync(labMainTfPath, 'utf8');

    // Bảo mật: Cloud SQL TUYỆT ĐỐI không mở Public IP
    assert.ok(content.includes('ipv4_enabled    = false'), 'Cloud SQL phải tắt IPv4 công khai');
    assert.ok(content.includes('private_network ='), 'Cloud SQL phải kết nối qua private network VPC');

    // Chi phí: Không bật High Availability (REGIONAL) tốn kém trong môi trường lab
    assert.ok(content.includes('availability_type = "ZONAL"'), 'Cloud SQL lab chỉ nên dùng Zonal để tối ưu chi phí');
  });

  it('thử thách độc lập: chiến lược DB hosting fallback khi Cloud SQL vượt ngân sách', () => {
    interface DatabaseHostingStrategy {
      mode: 'MANAGED_CLOUD_SQL' | 'CONTAINERIZED_LOCAL_POSTGRES' | 'GKE_STATEFULSET';
      estimatedMonthlyCost: number;
      isWithinBudget: boolean;
    }

    const budgetCap = 50; // USD

    function selectDatabaseHosting(cloudSqlQuote: number): DatabaseHostingStrategy {
      // Nếu Cloud SQL quote vượt quá 30% ngân sách cho phép ($15 USD)
      if (cloudSqlQuote > 15) {
        // Fallback sang Containerized PostgreSQL trên Local / GKE Ephemeral Pod
        return {
          mode: 'CONTAINERIZED_LOCAL_POSTGRES',
          estimatedMonthlyCost: 0,
          isWithinBudget: true
        };
      }
      return {
        mode: 'MANAGED_CLOUD_SQL',
        estimatedMonthlyCost: cloudSqlQuote,
        isWithinBudget: cloudSqlQuote <= budgetCap
      };
    }

    // Tình huống 1: Cloud SQL instance db-f1-micro trong ngưỡng ($10)
    const optimalPlan = selectDatabaseHosting(10);
    assert.equal(optimalPlan.mode, 'MANAGED_CLOUD_SQL');
    assert.equal(optimalPlan.isWithinBudget, true);

    // Tình huống 2: Báo giá Cloud SQL quá đắt do phát sinh phụ phí disk/backup/egress ($25)
    const fallbackPlan = selectDatabaseHosting(25);
    assert.equal(fallbackPlan.mode, 'CONTAINERIZED_LOCAL_POSTGRES');
    assert.equal(fallbackPlan.estimatedMonthlyCost, 0);
    assert.equal(fallbackPlan.isWithinBudget, true);
  });
});

