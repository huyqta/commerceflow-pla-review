import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('CF-031: Artifact Registry & Image Provenance', () => {
  const artifactPlanPath = path.resolve('docs/deployment/artifact-plan.md');

  it('xác minh tài liệu docs/deployment/artifact-plan.md tồn tại và đầy đủ tiêu chuẩn', () => {
    assert.ok(fs.existsSync(artifactPlanPath), 'artifact-plan.md phải tồn tại');
    const content = fs.readFileSync(artifactPlanPath, 'utf8');

    // Kiểm tra các nội dung trọng tâm
    assert.ok(content.includes('Artifact Registry & Image Provenance'), 'Thiếu tiêu đề chính');
    assert.ok(content.includes('Immutable Tagging Strategy'), 'Thiếu chiến lược immutable tag');
    assert.ok(content.includes('SHA-256 Digest'), 'Thiếu đặc tả SHA-256 digest');
    assert.ok(content.includes('SLSA Level 2/3 Compliance') || content.includes('in-toto'), 'Thiếu đặc tả provenance');
    assert.ok(content.includes('Rollback Image Digest'), 'Thiếu kịch bản rollback');
  });

  it('xác thực định dạng SHA-256 digest (tương thích micro-lab)', () => {
    const validDigest = 'sha256:' + 'a'.repeat(64);
    assert.match(validDigest, /^sha256:[a-f0-9]{64}$/, 'Digest hợp lệ phải có tiền tố sha256: và 64 ký tự hex');

    // Negative case: digest sai độ dài hoặc chứa ký tự không hợp lệ
    const invalidDigestShort = 'sha256:1234abcd';
    const invalidDigestChar = 'sha256:' + 'g'.repeat(64);
    const mutableTag = 'latest';

    assert.doesNotMatch(invalidDigestShort, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotMatch(invalidDigestChar, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotMatch(mutableTag, /^sha256:[a-f0-9]{64}$/);
  });

  it('mô phỏng quy trình kiểm tra Image Provenance (SLSA Statement)', () => {
    interface ProvenanceStatement {
      _type: string;
      subject: Array<{ name: string; digest: { sha256: string } }>;
      predicateType: string;
      predicate: {
        builder: { id: string };
        invocation: { configSource: { uri: string; digest: { sha1: string } } };
      };
    }

    const statement: ProvenanceStatement = {
      _type: 'https://in-toto.io/Statement/v0.1',
      subject: [
        {
          name: 'asia-southeast1-docker.pkg.dev/commerceflow-prod/commerceflow-apps/order-service',
          digest: {
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
          }
        }
      ],
      predicateType: 'https://slsa.dev/provenance/v0.2',
      predicate: {
        builder: { id: 'https://github.com/commerceflow/commerceflow/actions/runs/123456' },
        invocation: {
          configSource: {
            uri: 'git+https://github.com/commerceflow/commerceflow@refs/tags/v1.2.0',
            digest: { sha1: 'a1b2c3d4e5f67890123456789abcdef012345678' }
          }
        }
      }
    };

    assert.equal(statement._type, 'https://in-toto.io/Statement/v0.1');
    assert.ok(statement.subject[0].digest.sha256.length === 64);
    assert.ok(statement.predicate.builder.id.includes('github.com/commerceflow'));
  });

  it('thử thách độc lập: mô phỏng cơ chế rollback sang verified digest khi image mới bị lỗi', () => {
    interface DeploymentState {
      currentImage: string;
      previousStableDigest: string;
      status: 'HEALTHY' | 'UNHEALTHY';
    }

    const state: DeploymentState = {
      currentImage: 'asia-southeast1-docker.pkg.dev/cf/order-service@sha256:' + 'b'.repeat(64), // Bad release
      previousStableDigest: 'sha256:' + 'a'.repeat(64),
      status: 'UNHEALTHY'
    };

    // Hàm thực hiện rollback tức thì
    function triggerRollback(dep: DeploymentState): { rolledBack: boolean; activeImage: string } {
      if (dep.status === 'UNHEALTHY' && dep.previousStableDigest) {
        dep.currentImage = `asia-southeast1-docker.pkg.dev/cf/order-service@${dep.previousStableDigest}`;
        dep.status = 'HEALTHY';
        return { rolledBack: true, activeImage: dep.currentImage };
      }
      return { rolledBack: false, activeImage: dep.currentImage };
    }

    const result = triggerRollback(state);
    assert.equal(result.rolledBack, true);
    assert.ok(result.activeImage.endsWith('sha256:' + 'a'.repeat(64)));
    assert.equal(state.status, 'HEALTHY');
  });
});
