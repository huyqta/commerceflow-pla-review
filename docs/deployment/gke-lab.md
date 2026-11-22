# Kế hoạch Thực hành GKE Lab: Triển khai, Rollback & Quy trình Dọn dẹp (Teardown)

## 1. Giới thiệu & Mục tiêu
Tài liệu này xác định quy trình thực hành có kiểm soát trên **Google Kubernetes Engine (GKE)** cho dự án **CommerceFlow**, bao gồm:
- Dự toán chi phí lab theo giờ và cổng kiểm soát phê duyệt (Approval Gate).
- Chiến lược triển khai thử nghiệm trên Private GKE Cluster kết hợp Workload Identity.
- Kiểm thử cơ chế Rolling Update và Rollback tức thì trên Kubernetes.
- **Quy trình Dọn dẹp Toàn diện (Teardown & Cleanup Checklist)** loại bỏ 100% các phụ phí "ma" (Load Balancers, Static External IPs, Cloud NAT, Persistent Disks).

> [!IMPORTANT]
> **CẢNH BÁO QUAN TRỌNG VỀ PHÊ DUYỆT CLOUD (GCP POLICY):**
> GKE là tài nguyên có mức phí cố định theo giờ (Cluster Management Fee $0.10/giờ + Chi phí VM Compute). Do đó, **tuyệt đối KHÔNG chạy các lệnh `gcloud container clusters create` hoặc `terraform apply` lên GCP trong Issue này**. Mọi thao tác chỉ được kích hoạt sau khi có sự phê duyệt trực tiếp của Quản trị viên và **BẮT BUỘC PHẢI DỌN DẸP NGAY LẬP TỨC SAU KHI KẾT THÚC BUỔI DEMO**.

---

## 2. Dự toán Chi phí & Cổng Phê duyệt (Approval Gate & Cost Guard)

### 2.1. Dự toán Chi phí Thực hành GKE theo Giờ (Hourly Cost Estimation)
Mô hình lab ngắn hạn (2 giờ thực hành):
| Thành phần | Cấu hình | Đơn giá / giờ | Chi phí cho phiên lab 2 giờ |
| :--- | :--- | :---: | :---: |
| **GKE Cluster Management** | 1 Standard Zonal Cluster | $0.10 / giờ | $0.20 |
| **Worker Nodes (Compute Engine)** | 2 VM `e2-medium` (Spot/Preemptible) | ~$0.02 / VM/giờ | $0.08 |
| **Cloud Load Balancing (Ingress)** | 1 External Application Load Balancer | $0.025 / giờ | $0.05 |
| **Cloud NAT Gateway** | 1 Cloud NAT + 1 Static IP | $0.045 / giờ | $0.09 |
| **Persistent Disks (Boot disks)** | 2 x 30 GB Standard PD | ~$0.001 / giờ | $0.01 |
| **TỔNG CHI PHÍ PHIÊN LAB (2H)** | | | **~$0.43 USD** |

> [!TIP]
> Nhờ sử dụng **Spot/Preemptible VMs** và dọn dẹp ngay sau 2 giờ, chi phí thực tế chỉ tốn chưa tới **$0.50 USD**, hoàn toàn nằm trong ngân sách $50/tháng.

### 2.2. Điều kiện Cổng Phê duyệt (Approval Gate Requirements)
Lệnh tạo cluster GKE chỉ được thực thi khi thỏa mãn đồng thời 3 điều kiện:
1. `CLOUD_APPLY_APPROVED == "true"` (Đã có phê duyệt rõ ràng).
2. Thời gian bắt đầu và kết thúc buổi lab được ấn định trước (Time-boxed: tối đa 2 giờ).
3. Đã có kịch bản Teardown tự động bằng script.

---

## 3. Quy trình Triển khai & Rollback trên GKE

### 3.1. Triển khai Ứng dụng (Deploying API Gateway)
Sử dụng Kubernetes manifests đã hoàn thiện ở CF-036:
```bash
# 1. Kết nối kubectl tới GKE Cluster (sau khi có approval):
gcloud container clusters get-credentials commerceflow-gke-lab --region asia-southeast1

# 2. Áp dụng manifests
kubectl apply -f infra/kubernetes/base/deployment.yaml

# 3. Theo dõi quá trình rollout
kubectl rollout status deployment/commerceflow-api-gateway -n commerceflow
```

### 3.2. Kiểm thử Rollback Phiên bản (Rollback Verification)
Khi phát hiện bản deploy mới (`v1.3.0-buggy`) gặp sự cố CrashLoopBackOff:
```bash
# Xem lịch sử revisions
kubectl rollout history deployment/commerceflow-api-gateway -n commerceflow

# Rollback ngay về revision ổn định trước đó
kubectl rollout undo deployment/commerceflow-api-gateway -n commerceflow

# Xác nhận trạng thái sau rollback
kubectl get pods -n commerceflow -l app.kubernetes.io/name=api-gateway
```
- **Thời gian hoàn nguyên:** < 5 giây.
- **Tính khả dụng:** Giữ nguyên 100% kết nối của khách hàng nhờ `maxUnavailable: 0`.

---

## 4. Quy trình Dọn dẹp (Teardown Checklist - 3 Bước Khớp Micro-lab)

Theo chuẩn `labs/CF-037/demo.mjs`, quy trình teardown bắt buộc phải bao gồm đủ **3 bước theo thứ tự nghiêm ngặt**:

```
[1. Xóa Cloud Load Balancer & Ingress]
         │
         ▼
[2. Xóa GKE Cluster & Worker Nodes]
         │
         ▼
[3. Kiểm kê Hóa đơn & Tài nguyên (Verify Billing Inventory)]
```

### Chi tiết 3 Bước Teardown:
1. **Bước 1: Delete Load Balancer (`delete load balancer`)**
   - *Lý do:* Nếu xóa GKE cluster trước mà chưa xóa Service kiểu `LoadBalancer` hoặc Kubernetes `Ingress`, Google Cloud Load Balancer và Forwarding Rules sẽ bị mồ côi (orphaned), tiếp tục âm thầm tính phí duy trì IP tĩnh $0.025/giờ.
   - *Lệnh thực thi:*
     ```bash
     kubectl delete service api-gateway-service -n commerceflow
     kubectl delete ingress -n commerceflow --all
     ```
2. **Bước 2: Delete GKE Cluster (`delete GKE cluster`)**
   - *Lệnh thực thi:*
     ```bash
     gcloud container clusters delete commerceflow-gke-lab --region=asia-southeast1 --quiet
     ```
3. **Bước 3: Verify Billing Inventory (`verify billing inventory`)**
   - *Lý do:* Đảm bảo không còn ổ đĩa Persistent Disk, Cloud NAT, hay địa chỉ IP công khai nào bị bỏ quên.
   - *Lệnh kiểm tra:*
     ```bash
     gcloud compute forwarding-rules list
     gcloud compute addresses list
     gcloud compute disks list --filter="zone:asia-southeast1*"
     ```

---

## 5. Thử thách Độc lập & Đánh đổi Kỹ thuật (Trade-off)

### 5.1. Trade-off: Quên LoadBalancer / NAT Sau Lab (Ghost Billing Disaster)
- **Rủi ro lớn nhất:** Kỹ sư chỉ chạy lệnh xóa cluster nhưng quên mất Service `LoadBalancer` đã tự động sinh ra một Google Cloud Network Load Balancer kèm theo External Static IP.
- **Hậu quả:** Một IP tĩnh không gắn với VM đang chạy bị tính phí $0.01/giờ (~$7.2/tháng). Một Load Balancer bị bỏ quên tiêu tốn ~$18/tháng. Hai tài nguyên này kết hợp với Cloud NAT có thể âm thầm "ngốn" hơn $30/tháng dù không có bất kỳ dòng code nào đang chạy.
- **Giải pháp của CommerceFlow:** Áp dụng Checklist 3 bước Teardown tự động hóa, kiểm tra triệt để danh mục tài nguyên còn sót lại trước khi rời ca trực.
