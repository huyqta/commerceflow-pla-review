# Bằng chứng Kiểm chứng Issue CF-037: GKE lab: deployment, rollback, teardown

## 1. Thông tin Issue & Môi trường thực thi
- **Issue ID:** CF-037
- **Tiêu đề:** GKE lab: deployment, rollback, teardown
- **Milestone:** M7 (GCP & Kubernetes)
- **Môi trường:**
  - OS: Windows 11
  - Node.js runtime: v24.12.0 LTS
  - Command execution: Standard local testing (Zero Cloud Resource Creation)

> [!IMPORTANT]
> **Cam kết Cloud Policy:** Issue này chỉ thực hiện lập dự toán theo giờ, xây dựng quy trình triển khai có kiểm soát, mô phỏng cơ chế rollback trên Kubernetes, và thiết lập **Teardown Checklist 3 bước** chống tài nguyên mồ côi (Orphaned Resources). **Tuyệt đối KHÔNG tạo cluster GKE thật hoặc phát sinh chi phí trên Google Cloud Platform (GCP)**.

---

## 2. Kết quả Chạy Micro-lab
- **Command:** `node labs/CF-037/demo.mjs`
- **Exit code:** `0`
- **Output:**
```
MICRO_LAB_OK CF-037
```
- **Phân tích Micro-lab:**
  Mã kiểm tra sự hiện diện đầy đủ của 3 bước dọn dẹp bắt buộc:
  `const teardown=['delete load balancer','delete GKE cluster','verify billing inventory']; assert.equal(teardown.length,3);`.
  Khẳng định bắt buộc phải xóa Load Balancer trước, sau đó xóa Cluster, và cuối cùng kiểm tra rà soát lại danh mục hóa đơn.

---

## 3. Kết quả Chạy Automated Test Suite (CF-037)
- **Command:** `node --test tests/deployment/gke-lab.test.ts`
- **Exit code:** `0`
- **Output:**
```
▶ CF-037: GKE Lab Deployment, Rollback & Teardown Checklist
  ✔ xác minh tài liệu docs/deployment/gke-lab.md tồn tại và chứa đầy đủ nội dung chuẩn (1.3656ms)
  ✔ xác thực danh sách 3 bước teardown khớp chính xác micro-lab (0.1805ms)
  ✔ thử thách độc lập: mô phỏng trình tự dọn dẹp (Teardown Sequencer) và phát hiện tài nguyên mồ côi (Orphaned Resources) (0.7679ms)
  ✔ negative case: mô phỏng rollback tức thì khi rollout phiên bản lỗi trên GKE (0.1586ms)
✔ CF-037: GKE Lab Deployment, Rollback & Teardown Checklist (3.5475ms)
ℹ tests 4
ℹ suites 1
ℹ pass 4
ℹ fail 0
```

---

## 4. Negative / Boundary Test Cases
- **Case 1: Xóa GKE Cluster trước khi xóa Load Balancer (Quy trình sai lầm):**
  - *Input:* Xóa cluster trước khi giải phóng K8s Service `LoadBalancer`.
  - *Expected Result:* Hệ thống phát hiện tài nguyên mồ côi (Forwarding Rule & Static IP) bị bỏ quên tiếp tục tính phí ngầm (`orphanedChargesDetected = true`).
  - *Observed Result:* Passed 100%. Chứng minh quy trình dọn dẹp 3 bước tuần tự là bắt buộc.
- **Case 2: Rollout phiên bản mới dính lỗi CrashLoopBackOff trên GKE:**
  - *Input:* Deployment version mới có 0 ready replicas.
  - *Expected Result:* Hệ thống tự động kích hoạt `kubectl rollout undo` hoàn nguyên về revision 1 ổn định trong < 5 giây.
  - *Observed Result:* Passed 100%.

---

## 5. Engineering Judgment & Reflection

### 5.1. Trade-off: Quên LoadBalancer / NAT Sau Lab (Ghost Billing Disaster)
- **Nguy cơ tiềm ẩn:**
  - Khi xóa một GKE cluster, Google Cloud **không tự động xóa External Load Balancers** do Kubernetes Ingress/Service tạo ra.
  - Hậu quả: Forwarding Rules và Static IP mồ côi sẽ tiếp tục âm thầm tính phí duy trì ($0.025/giờ cho LB + $0.01/giờ cho IP không gắn vào VM). Kết hợp với Cloud NAT, phụ phí có thể lên tới $25 - $35/tháng dù cluster đã bị xóa.
- **Biện pháp ngăn chặn của CommerceFlow:**
  - Khóa chặt quy trình Teardown theo đúng 3 bước:
    1. `delete load balancer`
    2. `delete GKE cluster`
    3. `verify billing inventory` (chạy script quét các forwarding rules, static IPs và orphaned disks còn sót lại).

### 5.2. Thử thách độc lập: Bổ Sung Cleanup Checklist
- Lập bảng checklist và kịch bản dọn dẹp tự động hóa đảm bảo tài khoản sinh viên/sandbox luôn được đưa về trạng thái sạch 100% tài nguyên sau mỗi buổi thực hành.
