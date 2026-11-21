# Chuẩn bị môi trường — hướng dẫn chưa được kiểm chứng toàn bộ

## Baseline đề xuất
- Node.js 24 LTS theo Prisma mới, pnpm qua Corepack; NestJS 12 candidate. Kiểm tra compatibility và pin sau khi có dependency lockfile.
- Git, Docker Engine/Desktop + Compose, PostgreSQL qua Docker, Google Cloud CLI, Terraform, kind/kubectl.
- Windows: sử dụng WSL2 Ubuntu cho các lệnh POSIX bên dưới. PowerShell thuần cần điều chỉnh cú pháp shell; không giả định script bash chạy nguyên trạng.
- macOS/Linux: Bash hoặc shell tương thích. Không cần GCP credentials cho M1–M6.

## Không cần cài dependencies để chạy micro-labs
```bash
node --version
npm --version
git --version
node --experimental-strip-types --test starter/tests/*.test.ts
node labs/CF-001/demo.mjs
```

## Smoke khi cài xong toàn bộ công cụ (chạy riêng, ghi kết quả)
```bash
pnpm --version
docker --version
docker compose version
gcloud --version
terraform version
kind version
kubectl version --client
```

Expected: tool version, command exit 0; thiếu tool không ngăn chạy micro-labs trong giai đoạn early learning. Không đăng nhập cloud để chạy smoke local.

## Secrets & cleanup
- Sao chép `.env.example` thành `.env` chỉ ở máy local; `.env` bị `.gitignore` loại bỏ.
- GCP: project sandbox riêng, budget alert, không chạy Terraform apply trước phê duyệt. Khi lab cloud hoàn thành phải kiểm tra trạng thái resources và Billing, không coi `terraform destroy` chạy là đủ nếu có orphan resources.

---

[ANSWER]
## Đặc tả Cấu hình Môi trường Thực tế & Smoke Tests (CommerceFlow)

### 1. Bảng phiên bản công cụ đã kiểm chứng
| Công cụ | Phiên bản thực tế | Yêu cầu tối thiểu | Trạng thái |
| :--- | :--- | :--- | :--- |
| **Node.js** | v24.12.0 LTS | >= 20.x (khuyến nghị 24 LTS) | Đạt (Pass) |
| **Git** | 2.52.0.windows.1 | >= 2.30+ | Đạt (Pass) |
| **Docker Engine** | 29.4.1 (build 055a478) | >= 24.x | Đạt (Pass) |
| **pnpm** | 10.28.2 | >= 9.x | Đạt (Pass) |
| **TypeScript Runtime** | Node Native `--experimental-strip-types` | Node >= 22.6+ | Đạt (Pass) |

### 2. Kết quả Starter Domain Tests
- **Lệnh chạy:** `node --experimental-strip-types --test starter/tests/*.test.ts`
- **Kết quả:** 3/3 tests pass (100%):
  - `mới tạo đơn là PENDING` (Kiểm chứng Scenario R-01/R-05)
  - `không confirm đơn đã hủy` (Kiểm chứng Business invariant R-03)
  - `không nhận id rỗng` (Kiểm chứng Validation invariant)
- **Ý nghĩa:** Domain model cốt lõi thực thi trực tiếp trên Node native type-stripping mà không cần bước build phụ trợ, đảm bảo tính độc lập tối đa của tầng nghiệp vụ.

### 3. Nguyên tắc an toàn môi trường (Safety Guardrails)
- Không lưu credentials thật vào git (`.env` được loại trừ trong `.gitignore`).
- Môi trường dev phân tách hoàn toàn với production; các bài lab cloud ở M1–M6 không tự ý tạo tài nguyên thật.
- Chuẩn hóa các script thực thi qua Node.js để chạy độc lập nền tảng giữa Windows PowerShell và Linux/macOS.

