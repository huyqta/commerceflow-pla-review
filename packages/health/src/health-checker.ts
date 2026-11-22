// packages/health/src/health-checker.ts
// Health Probes Abstraction: Liveness, Readiness & Startup Checks
// Phục vụ Milestone M6 (CF-028 — Multi-stage Docker và health probes)

export interface DependencyCheckResult {
  readonly status: 'UP' | 'DOWN';
  readonly latencyMs?: number;
  readonly error?: string;
}

export interface ReadinessReport {
  readonly status: 'HEALTHY' | 'UNHEALTHY';
  readonly checks: Record<string, DependencyCheckResult>;
  readonly timestamp: Date;
}

export interface LivenessReport {
  readonly status: 'ALIVE' | 'DEAD';
  readonly uptimeSeconds: number;
  readonly memoryUsage: NodeJS.MemoryUsage;
  readonly timestamp: Date;
}

export class HealthProbeService {
  private readonly startTime = Date.now();
  private readonly dependencyCheckers = new Map<string, () => Promise<DependencyCheckResult>>();

  /**
   * Đăng ký một kiểm tra phụ thuộc (ví dụ Database connection, Redis, Message Broker)
   */
  public registerDependency(name: string, checker: () => Promise<DependencyCheckResult>): void {
    this.dependencyCheckers.set(name, checker);
  }

  /**
   * Liveness Probe: Kiểm tra xem tiến trình Node.js có còn sống và không bị deadlock
   * Nếu Liveness trả về DEAD -> Kubernetes / Docker Swarm sẽ RESTART container
   */
  public getLivenessReport(): LivenessReport {
    return {
      status: 'ALIVE',
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date(),
    };
  }

  /**
   * Readiness Probe: Kiểm tra xem container có sẵn sàng tiếp nhận traffic người dùng không
   * Nếu Readiness trả về UNHEALTHY -> Kubernetes sẽ GỠ container khỏi Load Balancer (KHÔNG restart)
   */
  public async getReadinessReport(): Promise<ReadinessReport> {
    const checks: Record<string, DependencyCheckResult> = {};
    let isAllHealthy = true;

    for (const [name, checker] of this.dependencyCheckers.entries()) {
      try {
        const result = await checker();
        checks[name] = result;
        if (result.status === 'DOWN') {
          isAllHealthy = false;
        }
      } catch (err: any) {
        checks[name] = {
          status: 'DOWN',
          error: err?.message || 'Check failed',
        };
        isAllHealthy = false;
      }
    }

    return {
      status: isAllHealthy ? 'HEALTHY' : 'UNHEALTHY',
      checks,
      timestamp: new Date(),
    };
  }
}

