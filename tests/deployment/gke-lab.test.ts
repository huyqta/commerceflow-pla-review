import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('CF-037: GKE Lab Deployment, Rollback & Teardown Checklist', () => {
  const gkeLabDocPath = path.resolve('docs/deployment/gke-lab.md');

  it('xác minh tài liệu docs/deployment/gke-lab.md tồn tại và chứa đầy đủ nội dung chuẩn', () => {
    assert.ok(fs.existsSync(gkeLabDocPath), 'docs/deployment/gke-lab.md phải tồn tại');
    const content = fs.readFileSync(gkeLabDocPath, 'utf8');

    // Kiểm tra các nội dung trọng tâm
    assert.ok(content.includes('Kế hoạch Thực hành GKE Lab'), 'Thiếu tiêu đề chính');
    assert.ok(content.includes('Dự toán Chi phí Thực hành GKE theo Giờ'), 'Thiếu dự toán chi phí');
    assert.ok(content.includes('Quy trình Dọn dẹp (Teardown Checklist'), 'Thiếu checklist dọn dẹp');
    assert.ok(content.includes('delete load balancer'), 'Thiếu bước delete load balancer');
    assert.ok(content.includes('delete GKE cluster'), 'Thiếu bước delete GKE cluster');
    assert.ok(content.includes('verify billing inventory'), 'Thiếu bước verify billing inventory');
    assert.ok(content.includes('Quên LoadBalancer / NAT Sau Lab'), 'Thiếu phân tích trade-off');
  });

  it('xác thực danh sách 3 bước teardown khớp chính xác micro-lab', () => {
    // Micro-lab assertion: const teardown=['delete load balancer','delete GKE cluster','verify billing inventory']; assert.equal(teardown.length,3);
    const teardown = ['delete load balancer', 'delete GKE cluster', 'verify billing inventory'];
    assert.equal(teardown.length, 3);
    assert.equal(teardown[0], 'delete load balancer');
    assert.equal(teardown[1], 'delete GKE cluster');
    assert.equal(teardown[2], 'verify billing inventory');
  });

  it('thử thách độc lập: mô phỏng trình tự dọn dẹp (Teardown Sequencer) và phát hiện tài nguyên mồ côi (Orphaned Resources)', () => {
    interface CloudResourceState {
      gkeClusterExists: boolean;
      loadBalancerExists: boolean;
      staticIpAllocated: boolean;
      forwardingRuleActive: boolean;
      orphanedChargesDetected: boolean;
    }

    // Tình huống sai lầm phổ biến: Xóa GKE cluster TRƯỚC khi xóa Load Balancer
    function flawedTeardown(state: CloudResourceState) {
      state.gkeClusterExists = false; // Xóa cluster trước
      // Load balancer và Static IP bị bỏ quên
      if (state.loadBalancerExists || state.staticIpAllocated) {
        state.orphanedChargesDetected = true; // Phát sinh phụ phí ma
      }
    }

    const wrongState: CloudResourceState = {
      gkeClusterExists: true,
      loadBalancerExists: true,
      staticIpAllocated: true,
      forwardingRuleActive: true,
      orphanedChargesDetected: false
    };
    flawedTeardown(wrongState);
    assert.equal(wrongState.orphanedChargesDetected, true, 'Quy trình sai phải phát hiện phụ phí ma bị bỏ quên');

    // Tình huống chuẩn hóa CommerceFlow: Dọn dẹp theo đúng 3 bước tuần tự
    function correctTeardown(state: CloudResourceState): string[] {
      const auditLog: string[] = [];

      // Bước 1: Xóa Load Balancer & giải phóng IP
      state.loadBalancerExists = false;
      state.forwardingRuleActive = false;
      state.staticIpAllocated = false;
      auditLog.push('delete load balancer');

      // Bước 2: Xóa GKE Cluster
      state.gkeClusterExists = false;
      auditLog.push('delete GKE cluster');

      // Bước 3: Kiểm kê tài nguyên còn sót lại
      state.orphanedChargesDetected = state.loadBalancerExists || state.staticIpAllocated || state.gkeClusterExists;
      auditLog.push('verify billing inventory');

      return auditLog;
    }

    const goodState: CloudResourceState = {
      gkeClusterExists: true,
      loadBalancerExists: true,
      staticIpAllocated: true,
      forwardingRuleActive: true,
      orphanedChargesDetected: false
    };

    const logs = correctTeardown(goodState);
    assert.deepEqual(logs, ['delete load balancer', 'delete GKE cluster', 'verify billing inventory']);
    assert.equal(goodState.orphanedChargesDetected, false, 'Dọn dẹp chuẩn không để lại bất kỳ tài nguyên tính phí nào');
    assert.equal(goodState.gkeClusterExists, false);
    assert.equal(goodState.loadBalancerExists, false);
  });

  it('negative case: mô phỏng rollback tức thì khi rollout phiên bản lỗi trên GKE', () => {
    interface K8sDeploymentRollout {
      currentRevision: number;
      activeImage: string;
      readyReplicas: number;
      isRolledBack: boolean;
    }

    const deployment: K8sDeploymentRollout = {
      currentRevision: 2,
      activeImage: 'commerceflow/api-gateway:v1.3.0-buggy',
      readyReplicas: 0, // CrashLoopBackOff
      isRolledBack: false
    };

    function handleRolloutFailure(dep: K8sDeploymentRollout, stableRevision: number, stableImage: string) {
      if (dep.readyReplicas === 0) {
        // Thực thi tương đương `kubectl rollout undo`
        dep.currentRevision = stableRevision;
        dep.activeImage = stableImage;
        dep.readyReplicas = 2;
        dep.isRolledBack = true;
      }
    }

    handleRolloutFailure(deployment, 1, 'commerceflow/api-gateway:v1.2.0');
    assert.equal(deployment.isRolledBack, true);
    assert.equal(deployment.currentRevision, 1);
    assert.equal(deployment.activeImage, 'commerceflow/api-gateway:v1.2.0');
    assert.equal(deployment.readyReplicas, 2);
  });
});

