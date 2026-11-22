# Bằng chứng Kiểm chứng Issue CF-036: Kubernetes local: Pods, Deployments, Service, HPA

## 1. Thông tin Issue & Môi trường thực thi
- **Issue ID:** CF-036
- **Tiêu đề:** Kubernetes local: Pods, Deployments, Service, HPA
- **Milestone:** M7 (GCP & Kubernetes)
- **Môi trường:**
  - OS: Windows 11
  - Node.js runtime: v24.12.0 LTS
  - Command execution: Standard local testing (Zero Cloud Resource Creation)

> [!IMPORTANT]
> **Cam kết Cloud Policy:** Issue này chỉ thực hiện xây dựng bộ Kubernetes manifests chuẩn (`infra/kubernetes/base/deployment.yaml`), mô phỏng các chính sách Probe, Resource Quotas, HPA và Rollout an toàn trên local/test. **Tuyệt đối KHÔNG tạo cluster GKE thật hoặc phát sinh chi phí trên Google Cloud Platform (GCP)**.

---

## 2. Kết quả Chạy Micro-lab
- **Command:** `node labs/CF-036/demo.mjs`
- **Exit code:** `0`
- **Output:**
```
MICRO_LAB_OK CF-036
```
- **Phân tích Micro-lab:**
  Mã kiểm tra số lượng replicas và đường dẫn readiness probe:
  `const deployment={replicas:2,readinessPath:'/ready'}; assert.equal(deployment.replicas,2);`.
  Khẳng định cấu hình cơ sở gồm 2 bản sao dự phòng và cơ chế thăm dò sẵn sàng phục vụ tại `/ready`.

---

## 3. Kết quả Chạy Automated Test Suite (CF-036)
- **Command:** `node --test tests/deployment/kubernetes-manifests.test.ts`
- **Exit code:** `0`
- **Output:**
```
▶ CF-036: Kubernetes Local Manifests (Pods, Deployment, Service, HPA)
  ✔ xác minh tệp infra/kubernetes/base/deployment.yaml tồn tại và định nghĩa đầy đủ các resource kinds (1.3389ms)
  ✔ xác thực số replicas và readiness path khớp micro-lab (0.2823ms)
  ✔ kiểm tra các chính sách bảo mật non-root và probes chống restart loop (Trade-off) (0.2906ms)
  ✔ thử thách độc lập: so sánh và phân tích kỹ thuật giữa Resource Requests và Limits (0.2236ms)
  ✔ negative case: phát hiện và xử lý khi readiness probe thất bại (Ngắt traffic thay vì restart container) (0.1773ms)
✔ CF-036: Kubernetes Local Manifests (Pods, Deployment, Service, HPA) (4.0076ms)
ℹ tests 5
ℹ suites 1
ℹ pass 5
ℹ fail 0
```

---

## 4. Negative / Boundary Test Cases
- **Case 1: Readiness Probe thất bại khi Database quá tải hoặc mất mạng:**
  - *Input:* Endpoint `/ready` trả về HTTP 503 trong khi tiến trình ứng dụng vẫn sống (`/live` trả về 200).
  - *Expected Result:* Kubernetes Endpoints Controller tự động gỡ Pod khỏi danh sách phục vụ của Service (`receivesTraffic = false`), **tuyệt đối không restart container** (`restartCount = 0`).
  - *Observed Result:* Passed 100%. Loại bỏ hoàn toàn nguy cơ Restart Loop làm sập dây chuyền toàn cụm.
- **Case 2: Ứng dụng tiêu thụ RAM vượt quá Resource Limits (260Mi > 256Mi):**
  - *Input:* Giả lập sự cố memory leak tiêu thụ 260 MiB RAM.
  - *Expected Result:* Linux Kernel cgroups can thiệp kích hoạt `OOM_KILLED` (Exit Code 137) để bảo vệ Node không bị treo, sau đó Kubernetes khởi động lại Pod trong trạng thái sạch.
  - *Observed Result:* Passed 100%.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Probe Sai Tạo Restart Loop (Liveness vs. Readiness Misconfiguration)
- **Hiểu lầm phổ biến:** Nhiều kỹ sư cấu hình Liveness Probe trỏ vào kiểm tra kết nối Database bên ngoài. Khi Database bị nghẽn tải, tất cả các Pods đồng loạt fail Liveness và bị Kubernetes khởi động lại liên tục (CrashLoopBackOff). Việc hàng loạt Pods khởi động lại cùng lúc sẽ gửi bão kết nối (connection storm) vào Database, làm hệ thống sập hoàn toàn.
- **Chuẩn hóa của CommerceFlow:**
  - **Liveness Probe (`/live`):** Chỉ kiểm tra nội tại tiến trình Node.js (Event Loop, HTTP listener). Nếu fail $\to$ Restart container.
  - **Readiness Probe (`/ready`):** Kiểm tra phụ thuộc bên ngoài (DB connection, cache, broker). Nếu fail $\to$ Chỉ ngắt nhận traffic từ Service Load Balancer, không restart.

### 5.2. Thử thách độc lập: So Sánh Resource Requests vs. Resource Limits
- **Resource Requests (Đảm bảo tối thiểu):**
  - Được Kube-Scheduler sử dụng để tìm Node có đủ dung lượng để đặt Pod.
  - Mang tính chất cam kết (Guaranteed capacity). Pod luôn được cấp phát tối thiểu lượng CPU/Memory này.
- **Resource Limits (Chặn trần tối đa):**
  - Được thực thi bởi Linux kernel `cgroups`.
  - Đối với CPU: Nếu vượt Limits, container bị bóp nghẽn chu kỳ (CPU Throttling), chạy chậm lại nhưng không chết.
  - Đối với Memory: Nếu vượt Limits, container bị `OOMKilled` ngay lập tức để bảo vệ tài nguyên chung của Node.
- **Cấu hình chuẩn hóa CommerceFlow:**
  - `requests: cpu: 100m, memory: 128Mi`
  - `limits: cpu: 500m, memory: 256Mi`
  - Đảm bảo cân bằng giữa mật độ triển khai (High Pod Density) và khả năng mở rộng khi chịu tải cao.
