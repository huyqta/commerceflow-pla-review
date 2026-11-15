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
