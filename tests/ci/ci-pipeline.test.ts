import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('CF-029: GitHub Actions CI Pipeline (lint, typecheck, test, build)', () => {
  const ciWorkflowPath = path.resolve('.github/workflows/ci.yml');

  it('should verify .github/workflows/ci.yml exists and contains all 4 mandatory jobs matching micro-lab', () => {
    assert.ok(fs.existsSync(ciWorkflowPath), 'CI workflow file must exist at .github/workflows/ci.yml');

    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    // Micro-lab assertion: const jobs=['lint','typecheck','test','build']; assert.equal(new Set(jobs).size,4);
    const jobs = ['lint', 'typecheck', 'test', 'build'];
    assert.equal(new Set(jobs).size, 4);

    for (const job of jobs) {
      assert.ok(content.includes(`${job}:`), `Workflow must declare job: ${job}`);
    }
  });

  it('Trade-off: should enforce Principle of Least Privilege by pinning read-only permissions', () => {
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    // 1. Workflow-level permissions
    assert.ok(content.includes('permissions:'), 'Workflow must explicitly declare permissions block');
    assert.ok(content.includes('contents: read'), 'Permissions must be restricted to contents: read');

    // 2. Negative check: tuyệt đối không cấp write permissions bừa bãi
    assert.equal(content.includes('write-all'), false, 'Never allow write-all permissions in CI');
    assert.equal(content.includes('contents: write'), false, 'Never allow contents: write on PR trigger');
  });

  it('Independent Challenge: should implement dependency caching for package manager and Docker layers', () => {
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    // 1. Node/npm caching
    assert.ok(content.includes('actions/cache@v4'), 'Must use actions/cache for persistent dependencies');
    assert.ok(content.includes('cache: \'npm\'') || content.includes('cache: "npm"'), 'Setup-node must enable npm cache');

    // 2. Docker layer caching
    assert.ok(content.includes('.buildx-cache') || content.includes('cache-from'), 'Should include Docker caching strategy');
  });

  it('should specify triggers for push to main and pull_request', () => {
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    assert.ok(content.includes('push:'), 'Must trigger on push');
    assert.ok(content.includes('pull_request:'), 'Must trigger on pull_request');
    assert.ok(content.includes('main'), 'Must target main branch');
  });

  it('Negative Case: should prevent duplicate runs on same branch using concurrency control', () => {
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    assert.ok(content.includes('concurrency:'), 'Must define concurrency group');
    assert.ok(content.includes('cancel-in-progress: true'), 'Must cancel in-progress runs to save compute resources');
  });
});

