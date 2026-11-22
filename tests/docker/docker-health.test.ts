import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HealthProbeService } from '../../packages/health/src/health-checker.ts';

describe('CF-028: Multi-stage Docker, Security and Health Probes', () => {
  // -------------------------------------------------------------
  // 1. Dockerfile Analysis & Multi-Stage Verification
  // -------------------------------------------------------------
  it('should verify infra/docker/Dockerfile contains multi-stage stages (base, builder, runner)', () => {
    const dockerfilePath = path.resolve('infra/docker/Dockerfile');
    assert.ok(fs.existsSync(dockerfilePath), 'Dockerfile must exist in infra/docker/');

    const content = fs.readFileSync(dockerfilePath, 'utf8');

    // 1. Multi-stage build patterns
    assert.ok(content.includes('FROM node:24-alpine AS base'), 'Must define base stage on Node 24 alpine');
    assert.ok(content.includes('FROM base AS builder'), 'Must define builder stage');
    assert.ok(content.includes('FROM base AS runner'), 'Must define production runner stage');

    // 2. Non-root user compliance
    assert.ok(content.includes('USER nodejs'), 'Must switch to non-root user in production image');
    assert.ok(content.includes('adduser'), 'Must create non-root user');

    // 3. Healthcheck probe in Dockerfile
    assert.ok(content.includes('HEALTHCHECK'), 'Must define Docker HEALTHCHECK instruction');
    assert.ok(content.includes('/health/liveness'), 'Healthcheck must target health endpoint');

    // 4. Signal handling PID 1
    assert.ok(content.includes('dumb-init'), 'Must use dumb-init for proper signal handling');
  });

  // -------------------------------------------------------------
  // 2. Trade-off: Zero Secret Leakage (.dockerignore & .env exclusion)
  // -------------------------------------------------------------
  it('Trade-off: should strictly exclude .env and sensitive secrets in .dockerignore', () => {
    const dockerignorePath = path.resolve('.dockerignore');
    assert.ok(fs.existsSync(dockerignorePath), '.dockerignore must exist');

    const content = fs.readFileSync(dockerignorePath, 'utf8');
    const lines = content.split('\n').map(l => l.trim());

    assert.ok(lines.includes('.env'), 'Must ignore .env file');
    assert.ok(lines.includes('.env.*'), 'Must ignore all .env variants');
    assert.ok(lines.includes('node_modules'), 'Must ignore local node_modules');
    assert.ok(lines.includes('.git'), 'Must ignore .git repository data');
  });

  // -------------------------------------------------------------
  // 3. Thử thách độc lập: Phân biệt Liveness vs Readiness Probe
  // -------------------------------------------------------------
  it('Independent Challenge: should differentiate Liveness vs Readiness semantics', async () => {
    const healthService = new HealthProbeService();

    // 1. Khi chưa có lỗi: Cả Liveness và Readiness đều OK
    healthService.registerDependency('http_server', async () => ({ status: 'UP', latencyMs: 2 }));
    healthService.registerDependency('database', async () => ({ status: 'UP', latencyMs: 15 }));

    const initialLiveness = healthService.getLivenessReport();
    assert.equal(initialLiveness.status, 'ALIVE');

    const initialReadiness = await healthService.getReadinessReport();
    assert.equal(initialReadiness.status, 'HEALTHY');

    // 2. Tình huống: Database tạm thời mất kết nối (Database Glitch)
    // - Micro-lab assertion: const readiness={http:true,database:false}; assert.equal(Object.values(readiness).every(Boolean),false);
    const brokenHealthService = new HealthProbeService();
    brokenHealthService.registerDependency('http_server', async () => ({ status: 'UP' }));
    brokenHealthService.registerDependency('database', async () => ({
      status: 'DOWN',
      error: 'Connection refused: 5432',
    }));

    // Liveness vẫn ALIVE (Tiến trình Node.js không bị treo hoặc crash) -> Không cần restart container
    const brokenLiveness = brokenHealthService.getLivenessReport();
    assert.equal(brokenLiveness.status, 'ALIVE');

    // Nhưng Readiness phải UNHEALTHY -> Kubernetes sẽ ngắt traffic khỏi container này để chờ DB hồi phục
    const brokenReadiness = await brokenHealthService.getReadinessReport();
    assert.equal(brokenReadiness.status, 'UNHEALTHY');
    assert.equal(brokenReadiness.checks.database.status, 'DOWN');
  });

  // -------------------------------------------------------------
  // 4. Docker Compose Verification & Service Health Dependencies
  // -------------------------------------------------------------
  it('should verify docker-compose.yml defines healthcheck dependencies', () => {
    const composePath = path.resolve('infra/docker/docker-compose.yml');
    assert.ok(fs.existsSync(composePath), 'docker-compose.yml must exist in infra/docker/');

    const content = fs.readFileSync(composePath, 'utf8');
    assert.ok(content.includes('condition: service_healthy'), 'API Gateway must wait for PostgreSQL service_healthy');
    assert.ok(content.includes('healthcheck:'), 'Services must define healthcheck parameters');
  });

  // -------------------------------------------------------------
  // 5. Negative Case: Dependency check exception handling
  // -------------------------------------------------------------
  it('Negative Case: should handle uncaught exceptions in health checks safely without crashing', async () => {
    const healthService = new HealthProbeService();
    healthService.registerDependency('flaky_service', async () => {
      throw new Error('Socket abruptly disconnected');
    });

    const report = await healthService.getReadinessReport();
    assert.equal(report.status, 'UNHEALTHY');
    assert.equal(report.checks.flaky_service.status, 'DOWN');
    assert.equal(report.checks.flaky_service.error, 'Socket abruptly disconnected');
  });
});

