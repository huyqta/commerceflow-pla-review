import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('CF-036: Kubernetes Local Manifests (Pods, Deployment, Service, HPA)', () => {
  const deploymentYamlPath = path.resolve('infra/kubernetes/base/deployment.yaml');

  it('xác minh tệp infra/kubernetes/base/deployment.yaml tồn tại và định nghĩa đầy đủ các resource kinds', () => {
    assert.ok(fs.existsSync(deploymentYamlPath), 'deployment.yaml phải tồn tại');
    const content = fs.readFileSync(deploymentYamlPath, 'utf8');

    // Kiểm tra các kind Kubernetes cốt lõi
    assert.ok(content.includes('kind: Deployment'), 'Phải chứa Deployment manifest');
    assert.ok(content.includes('kind: Service'), 'Phải chứa Service manifest');
    assert.ok(content.includes('kind: HorizontalPodAutoscaler'), 'Phải chứa HPA manifest');
  });

  it('xác thực số replicas và readiness path khớp micro-lab', () => {
    // Micro-lab: const deployment={replicas:2,readinessPath:'/ready'}; assert.equal(deployment.replicas,2);
    const content = fs.readFileSync(deploymentYamlPath, 'utf8');

    assert.ok(content.includes('replicas: 2'), 'Deployment phải cấu hình 2 replicas ban đầu');
    assert.ok(content.includes('path: /ready'), 'Readiness probe path phải là /ready');
  });

  it('kiểm tra các chính sách bảo mật non-root và probes chống restart loop (Trade-off)', () => {
    const content = fs.readFileSync(deploymentYamlPath, 'utf8');

    // 1. Bảo mật: Non-root container
    assert.ok(content.includes('runAsNonRoot: true'), 'Container bắt buộc phải chạy non-root');
    assert.ok(content.includes('allowPrivilegeEscalation: false'), 'Chặn leo thang đặc quyền');

    // 2. Probes: Phân biệt rõ ràng giữa Liveness và Readiness
    assert.ok(content.includes('readinessProbe:'), 'Phải có readiness probe');
    assert.ok(content.includes('livenessProbe:'), 'Phải có liveness probe');
    assert.ok(content.includes('path: /live'), 'Liveness probe path phải là /live');

    // 3. Chiến lược Zero Downtime RollingUpdate
    assert.ok(content.includes('maxUnavailable: 0'), 'maxUnavailable phải bằng 0 để đảm bảo zero downtime');
  });

  it('thử thách độc lập: so sánh và phân tích kỹ thuật giữa Resource Requests và Limits', () => {
    interface ContainerResources {
      requests: { cpu: string; memory: string };
      limits: { cpu: string; memory: string };
    }

    const resources: ContainerResources = {
      requests: { cpu: '100m', memory: '128Mi' },
      limits: { cpu: '500m', memory: '256Mi' }
    };

    // Phân tích logic Kubernetes Scheduler & cgroups:
    // 1. Requests: Dùng bởi Kube-Scheduler để tìm Node có đủ dung lượng khả dụng đặt Pod (Guaranteed capacity)
    function parseCpu(cpu: string): number {
      return cpu.endsWith('m') ? parseInt(cpu) : parseInt(cpu) * 1000;
    }
    function parseMem(mem: string): number {
      return parseInt(mem.replace('Mi', ''));
    }

    assert.ok(parseCpu(resources.requests.cpu) <= parseCpu(resources.limits.cpu), 'Requests CPU không được lớn hơn Limits CPU');
    assert.ok(parseMem(resources.requests.memory) <= parseMem(resources.limits.memory), 'Requests Memory không được lớn hơn Limits Memory');

    // Phép thử kịch bản: Khi container dùng quá Requests nhưng dưới Limits -> Tiếp tục chạy bình thường (CPU throttling nếu CPU bị tranh chấp)
    // Khi container dùng RAM vượt quá Limits (256Mi) -> Kernel cgroups kích hoạt OOMKilled (Exit code 137)
    function simulateMemoryConsumption(usageMiB: number, limitMiB: number): 'OK' | 'OOM_KILLED' {
      return usageMiB > limitMiB ? 'OOM_KILLED' : 'OK';
    }

    assert.equal(simulateMemoryConsumption(200, 256), 'OK');
    assert.equal(simulateMemoryConsumption(260, 256), 'OOM_KILLED', 'Vượt quá limit RAM phải bị OOMKilled để bảo vệ Node');
  });

  it('negative case: phát hiện và xử lý khi readiness probe thất bại (Ngắt traffic thay vì restart container)', () => {
    interface PodState {
      isAlive: boolean;
      isReady: boolean;
      receivesTraffic: boolean;
      restartCount: number;
    }

    const pod: PodState = {
      isAlive: true,        // Tiến trình Node.js vẫn đang chạy (/live trả về 200)
      isReady: false,       // Nhưng cơ sở dữ liệu tạm ngắt kết nối (/ready trả về 503)
      receivesTraffic: true,
      restartCount: 0
    };

    // Logic Kubernetes Controller khi đánh giá Probes:
    function evaluateProbes(state: PodState) {
      // Nếu readiness thất bại: Chỉ ngắt Endpoints khỏi Service, KHÔNG tăng restartCount
      if (!state.isReady) {
        state.receivesTraffic = false;
      }
      // Nếu liveness thất bại: Mới kích hoạt restart container
      if (!state.isAlive) {
        state.restartCount += 1;
      }
    }

    evaluateProbes(pod);

    assert.equal(pod.receivesTraffic, false, 'Pod không sẵn sàng phải bị loại khỏi Service endpoints ngay lập tức');
    assert.equal(pod.restartCount, 0, 'Chỉ lỗi readiness TUYỆT ĐỐI KHÔNG được gây restart loop làm trầm trọng hóa sự cố');
  });
});

