# Kiến trúc CommerceFlow

## Giai đoạn 1: Modular Monolith
Một NestJS process gồm 4 modules: Catalog, Ordering, Inventory, Payments. Domain không import NestJS, Prisma hoặc HTTP.

## Giai đoạn 2: Microservices
React Web → API Gateway (authn/authz) → Catalog / Ordering / Inventory / Payments. Mỗi service sở hữu DB/schema và credentials. Ordering orchestration Saga qua event bus; transactional outbox và inbox chống dual-write/duplicate.

## Giai đoạn 3: Cloud Native
React static assets trên hosting phù hợp, backend chạy Cloud Run với authenticated service identities; Cloud SQL PostgreSQL, Pub/Sub push JWT, Secret Manager. GitHub Actions OIDC/WIF, Terraform plan/apply có approval; Cloud Logging/Monitoring/OpenTelemetry. GKE tạo riêng cho lab có teardown.

## Trật tự dependency sạch
Domain ← Application ← Infrastructure/Presentation (adapter); shared packages chỉ có contracts và infrastructure-neutral utilities.

## Nguồn quyết định
Đọc `docs/adr/ADR-001.md` đến `ADR-009.md`.

## Security/cost boundary
Không expose DB hoặc event handler vô điều kiện; private service ingress nếu phù hợp; IAM least privilege; không lưu service account JSON. Budget $50/month là mục tiêu thiết kế, không enforce spending cap. Phải ước lượng Cloud SQL + networking theo region trước apply.
