# Kế hoạch Đăng ký Artifact & Xuất xứ Image (Artifact Registry & Image Provenance)

## 1. Giới thiệu & Mục tiêu
Tài liệu này xác định kiến trúc, tiêu chuẩn gắn thẻ (tagging), kiểm soát toàn vẹn bằng SHA256 digest và tạo metadata xuất xứ (SLSA Provenance) cho các container images thuộc hệ thống **CommerceFlow**.

> [!IMPORTANT]
> **Tuân thủ quy tắc bảo mật & môi trường:**
> Giai đoạn này tập trung vào đặc tả quy trình build, tạo immutable tag, SHA digest hashing và metadata provenance trên local/CI. **Chưa thực hiện push hay tạo tài nguyên thật lên Google Cloud Platform (GCP Artifact Registry)** cho đến khi có sự phê duyệt trực tiếp từ quản trị viên.

---

## 2. Chiến lược Đặt tên & Gắn thẻ Immutable Tag (Immutable Tagging Strategy)

### 2.1. Định dạng Repository & Image URL
Quy ước định danh container image trên Google Artifact Registry (GAR):
`{region}-docker.pkg.dev/{project-id}/{repository}/{image}:{tag}`

Ví dụ:
`asia-southeast1-docker.pkg.dev/commerceflow-prod/commerceflow-apps/order-service:v1.2.0-git-a1b2c3d`

### 2.2. Cấu trúc Tag Immutable
Mỗi container image khi build ra bắt buộc phải mang ít nhất 2 tags:
1. **Semantic Version Tag:** `v{MAJOR}.{MINOR}.{PATCH}` (ví dụ: `v1.2.0`)
2. **Git Commit SHA Tag:** `sha-{SHORT_SHA}` hoặc kết hợp `v1.2.0-git-{SHORT_SHA}` (ví dụ: `v1.2.0-git-a1b2c3d`)
3. **Build Timestamp & Counter:** Đảm bảo tính duy nhất tuyệt đối trong chuỗi cung ứng phần mềm.

> [!CAUTION]
> **Tuyệt đối cấm sử dụng `:latest` tag trong môi trường Staging và Production.**
> `:latest` là mutable tag (có thể bị ghi đè). Nó phá vỡ tính lặp lại (reproducibility), làm tê liệt khả năng rollback chính xác, và có thể dẫn đến việc các Pods trong cùng một ReplicaSet chạy các phiên bản code khác nhau do chính sách `imagePullPolicy: IfNotPresent`.

---

## 3. Quản lý Toàn vẹn với SHA-256 Digest

Mọi lệnh triển khai Kubernetes (`Deployment.yaml`, `PodSpec`) hoặc lệnh chạy runtime bắt buộc phải trỏ chính xác vào immutable SHA-256 digest:
```yaml
spec:
  containers:
  - name: order-service
    image: asia-southeast1-docker.pkg.dev/commerceflow-prod/commerceflow-apps/order-service@sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

### Quy tắc Digest Invariant:
- Một container image sau khi build sẽ được sinh ra một hash SHA-256 duy nhất đại diện cho toàn bộ manifest và các layer tarballs.
- Digest không thể bị giả mạo hoặc ghi đè, ngay cả khi ai đó cố tình xóa và push lại một image khác cùng tag.

---

## 4. Đặc tả Image Provenance (SLSA Level 2/3 Compliance)

Xuất xứ image (Provenance) là một bản ghi metadata có chữ ký số (attestation) mô tả chi tiết:
- Source code repo URL (`https://github.com/commerceflow/commerceflow`)
- Git commit hash chính xác được dùng để build (`commit: a1b2c3d4...`)
- Pipeline & Runner ID (`GitHub Actions run #1234`)
- Environment biến và tham số build
- SHA-256 digest của đầu vào và đầu ra

### 4.1. Cấu trúc Provenance JSON Schema (in-toto / SLSA v0.2 / v1.0)
```json
{
  "_type": "https://in-toto.io/Statement/v0.1",
  "subject": [
    {
      "name": "asia-southeast1-docker.pkg.dev/commerceflow-prod/commerceflow-apps/order-service",
      "digest": {
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      }
    }
  ],
  "predicateType": "https://slsa.dev/provenance/v0.2",
  "predicate": {
    "builder": {
      "id": "https://github.com/commerceflow/commerceflow/actions/runs/123456"
    },
    "buildType": "https://github.com/actions/runner@v2",
    "invocation": {
      "configSource": {
        "uri": "git+https://github.com/commerceflow/commerceflow@refs/tags/v1.2.0",
        "digest": {
          "sha1": "a1b2c3d4e5f67890123456789abcdef012345678"
        },
        "entryPoint": ".github/workflows/ci.yml"
      }
    },
    "materials": [
      {
        "uri": "docker://node:24-alpine",
        "digest": {
          "sha256": "9b646c243a0d1e08922c070295dae5b4b10b06b2f4c9c1f6de7f32997f74c8b2"
        }
      }
    ]
  }
}
```

---

## 5. Quy trình Rollback & Thử thách Độc lập: Rollback Image Digest

### 5.1. Kịch bản Sự cố (Scenario)
Một bản deploy mới mang image `order-service@sha256:BAD_NEW_DIGEST` gặp lỗi rò rỉ bộ nhớ nghiêm trọng (Memory Leak) ngay khi đưa vào production.
Nếu dùng tag `:latest`, việc revert commit trên Git đòi hỏi phải build lại toàn bộ CI, mất từ 10 - 20 phút và tiềm ẩn lỗi mới.

### 5.2. Giải pháp Rollback bằng SHA Digest tức thì
Nhờ lưu trữ manifest lịch sử và digest trong hệ thống kiểm soát triển khai, quản trị viên thực hiện rollback tức thì về digest đã được kiểm chứng an toàn trước đó (`order-service@sha256:GOOD_PREV_DIGEST`):
```bash
# Rollback tức thì qua Kubernetes chỉ bằng việc cập nhật digest mục tiêu:
kubectl set image deployment/order-service order-service=asia-southeast1-docker.pkg.dev/commerceflow-prod/commerceflow-apps/order-service@sha256:GOOD_PREV_DIGEST
```
- **Thời gian khôi phục (MTTR):** < 5 giây (image layer đã được cache sẵn trên các K8s nodes).
- **Tính an toàn tuyệt đối:** Cam kết chạy đúng 100% bit-for-bit image đã chạy ổn định, không chịu ảnh hưởng từ môi trường build hay external dependencies.

---

## 6. Phân tích Đánh đổi Kỹ thuật (Trade-off Analysis)

| Phương pháp | Ưu điểm | Nhược điểm & Rủi ro |
| :--- | :--- | :--- |
| **Dùng `:latest` tag** | Đơn giản, script cấu hình K8s không cần sửa đổi mỗi lần deploy mới. | **Nguy hiểm cực độ:** Mất tính truy vết (untraceable), race conditions khi nhiều node pull ở thời điểm khác nhau, không thể rollback an toàn, vi phạm compliance. |
| **Dùng Immutable Tag (`v1.2.0-sha`)** | Dễ đọc cho con người, liên kết được phiên bản code với image. | Vẫn có rủi ro nhỏ nếu registry không khóa ghi đè (tag immutability setting bị tắt). |
| **Dùng SHA-256 Digest (`@sha256:...`)** | **Bất biến tuyệt đối (100% Immutable)**, bảo mật cao, rollback tức thì, chống hoàn toàn tấn công chuỗi cung ứng (tampering). | Chuỗi hash dài khó nhớ, cần công cụ CI/CD tự động hóa việc cập nhật digest vào file cấu hình K8s. |
