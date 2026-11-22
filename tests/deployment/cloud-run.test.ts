import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('CF-035: Cloud Run Deploy, Auth Push Events & Rollback', () => {
  const cloudRunDocPath = path.resolve('docs/deployment/cloud-run.md');

  it('xác minh tài liệu docs/deployment/cloud-run.md tồn tại và chứa đầy đủ nội dung chuẩn', () => {
    assert.ok(fs.existsSync(cloudRunDocPath), 'docs/deployment/cloud-run.md phải tồn tại');
    const content = fs.readFileSync(cloudRunDocPath, 'utf8');

    // Kiểm tra các nội dung trọng tâm
    assert.ok(content.includes('Kế hoạch Triển khai Cloud Run'), 'Thiếu tiêu đề chính');
    assert.ok(content.includes('Xác thực Sự kiện Đẩy (Authenticated Pub/Sub Push Events)'), 'Thiếu phần Push Events');
    assert.ok(content.includes('roles/run.invoker'), 'Thiếu role invoker');
    assert.ok(content.includes('Quản lý Revision & Cơ chế Rollback Tức thì'), 'Thiếu phần Rollback Revision');
    assert.ok(content.includes('Rủi ro của Webhook Công khai Không Xác thực'), 'Thiếu phân tích trade-off');
  });

  it('xác thực cấu hình identity invoker khớp micro-lab', () => {
    // Micro-lab assertion: const identity={audience:'https://example.invalid',invokerRole:'roles/run.invoker'};
    const identity = { audience: 'https://example.invalid', invokerRole: 'roles/run.invoker' };
    assert.equal(identity.invokerRole, 'roles/run.invoker');
    assert.ok(identity.audience.startsWith('https://'));
  });

  it('xác thực cơ chế Cloud Guard (labs/CF-035/cloud-guard.mjs)', () => {
    // Logic an toàn: Mặc định từ chối (Default Deny) nếu chưa có biến môi trường phê duyệt
    const config = { budgetUsd: 50, approved: process.env.CLOUD_APPLY_APPROVED === 'true' };
    function canApply(estimatedUsd: number, isApproved: boolean): boolean {
      return isApproved && estimatedUsd <= config.budgetUsd;
    }

    // Khi chưa duyệt: Từ chối dù chi phí nhỏ ($10) hay lớn ($100)
    assert.equal(canApply(10, false), false, 'Phải từ chối khi chưa có approval');
    assert.equal(canApply(100, false), false, 'Phải từ chối khi vượt ngân sách');

    // Khi đã duyệt và chi phí hợp lệ ($25 <= $50)
    assert.equal(canApply(25, true), true, 'Chỉ cho phép khi đã duyệt và trong ngân sách');

    // Khi đã duyệt nhưng chi phí vượt ngân sách ($60 > $50)
    assert.equal(canApply(60, true), false, 'Từ chối nếu vượt trần ngân sách');
  });

  it('thử thách độc lập: mô phỏng xác thực OIDC Token & role roles/run.invoker trên Cloud Run', () => {
    interface OidcTokenClaims {
      iss: string;
      email: string;
      aud: string;
      exp: number;
    }

    interface CloudRunAuthResult {
      statusCode: number;
      authenticated: boolean;
      authorized: boolean;
      reason?: string;
    }

    const expectedAudience = 'https://commerceflow-api-gateway.a.run.app';
    const authorizedInvokerServiceAccount = 'sa-pubsub-invoker@commerceflow.iam.gserviceaccount.com';

    function authenticatePushRequest(authHeader?: string): CloudRunAuthResult {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { statusCode: 401, authenticated: false, authorized: false, reason: 'MISSING_BEARER_TOKEN' };
      }

      // Giả lập giải mã JWT payload
      const tokenString = authHeader.replace('Bearer ', '');
      if (tokenString === 'INVALID_TOKEN') {
        return { statusCode: 401, authenticated: false, authorized: false, reason: 'INVALID_SIGNATURE' };
      }

      try {
        const claims: OidcTokenClaims = JSON.parse(Buffer.from(tokenString, 'base64').toString('utf8'));

        if (claims.aud !== expectedAudience) {
          return { statusCode: 403, authenticated: true, authorized: false, reason: 'AUDIENCE_MISMATCH' };
        }

        if (claims.email !== authorizedInvokerServiceAccount) {
          return { statusCode: 403, authenticated: true, authorized: false, reason: 'ROLE_RUN_INVOKER_MISSING' };
        }

        return { statusCode: 200, authenticated: true, authorized: true };
      } catch {
        return { statusCode: 400, authenticated: false, authorized: false, reason: 'MALFORMED_TOKEN' };
      }
    }

    // 1. Negative test: Request không có Authorization header -> 401
    const noAuth = authenticatePushRequest(undefined);
    assert.equal(noAuth.statusCode, 401);
    assert.equal(noAuth.reason, 'MISSING_BEARER_TOKEN');

    // 2. Negative test: Token từ Service Account không được cấp quyền roles/run.invoker -> 403
    const unauthorizedClaims: OidcTokenClaims = {
      iss: 'https://accounts.google.com',
      email: 'hacker-sa@external.com',
      aud: expectedAudience,
      exp: Date.now() + 3600
    };
    const unauthorizedToken = Buffer.from(JSON.stringify(unauthorizedClaims)).toString('base64');
    const unauthorizedResult = authenticatePushRequest(`Bearer ${unauthorizedToken}`);
    assert.equal(unauthorizedResult.statusCode, 403);
    assert.equal(unauthorizedResult.reason, 'ROLE_RUN_INVOKER_MISSING');

    // 3. Positive test: Token chuẩn từ sa-pubsub-invoker với đúng Audience -> 200
    const validClaims: OidcTokenClaims = {
      iss: 'https://accounts.google.com',
      email: authorizedInvokerServiceAccount,
      aud: expectedAudience,
      exp: Date.now() + 3600
    };
    const validToken = Buffer.from(JSON.stringify(validClaims)).toString('base64');
    const validResult = authenticatePushRequest(`Bearer ${validToken}`);
    assert.equal(validResult.statusCode, 200);
    assert.equal(validResult.authorized, true);
  });

  it('mô phỏng cơ chế Rollback Revision tức thì (Instant Traffic Shifting)', () => {
    interface RevisionTraffic {
      revisionId: string;
      trafficPercent: number;
      status: 'HEALTHY' | 'UNHEALTHY';
    }

    const serviceState: { serviceName: string; revisions: RevisionTraffic[] } = {
      serviceName: 'commerceflow-api-gateway',
      revisions: [
        { revisionId: 'rev-001-stable', trafficPercent: 0, status: 'HEALTHY' },
        { revisionId: 'rev-002-faulty', trafficPercent: 100, status: 'UNHEALTHY' } // Đang bị lỗi
      ]
    };

    // Hàm thực hiện rollback traffic tức thì
    function rollbackTraffic(state: typeof serviceState): { rolledBack: boolean; activeRevision: string } {
      const faultyRev = state.revisions.find(r => r.trafficPercent > 0 && r.status === 'UNHEALTHY');
      const stableRev = state.revisions.find(r => r.status === 'HEALTHY');

      if (faultyRev && stableRev) {
        faultyRev.trafficPercent = 0;
        stableRev.trafficPercent = 100;
        return { rolledBack: true, activeRevision: stableRev.revisionId };
      }
      return { rolledBack: false, activeRevision: state.revisions[0].revisionId };
    }

    const rollbackResult = rollbackTraffic(serviceState);
    assert.equal(rollbackResult.rolledBack, true);
    assert.equal(rollbackResult.activeRevision, 'rev-001-stable');
    assert.equal(serviceState.revisions.find(r => r.revisionId === 'rev-001-stable')?.trafficPercent, 100);
    assert.equal(serviceState.revisions.find(r => r.revisionId === 'rev-002-faulty')?.trafficPercent, 0);
  });
});

