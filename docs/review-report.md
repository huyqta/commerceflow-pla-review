# Kết quả kiểm chứng 14/11/2026

## Kiểm tra đã chạy (executed)
- `python scripts/validate_roadmap.py pla/roadmap.json --strict`: **PASS**, 40 Issues, 8 milestones, 0 warnings và 0 errors.
- `python scripts/validate_docs.py docs/requirements.md`: **PASS** smoke check file.
- `node --experimental-strip-types --test starter/tests/*.test.ts`: **PASS 3/3 tests** trong Node v22.16.0.
- `node --experimental-strip-types starter/scripts/smoke.ts`: **PASS**, `STARTER_SMOKE_OK PENDING`.
- 40/40 standalone micro-labs `labs/CF-xxx/demo.mjs`: **PASS** theo `evidence/micro-lab-results.json`.
- 4 specialized simulations: **PASS**, xem `evidence/extended-lab-results.json`.

## Chưa kiểm chứng (unverified/blocked)
- Không cài NestJS/React/Prisma; chưa chạy production API, frontend hoặc full E2E.
- Không kiểm chứng Node 24/NestJS 12/Prisma compatibility trên cùng lockfile; môi trường container dùng Node 22.16.0.
- Chưa chạy Docker Compose, PostgreSQL isolation/concurrency, GitHub Actions, Terraform validate/plan, Cloud Run, Pub/Sub, Cloud SQL hoặc GKE.
- Các micro-labs là demonstrations độc lập; chúng **không** chứng minh acceptance criteria của 40 Issues. Tất cả Issues vẫn `draft/unverified`.
- Chưa có complete private Reference Track; chỉ có `reference-plan`.
- Các Issues đã có mục tiêu, prerequisite, thao tác, snippet, tests mô phỏng và điều kiện DoD, nhưng chưa cung cấp toàn bộ triển khai NestJS/React/Terraform file-by-file có thể chạy. Phần này cần author/kiểm thử từng milestone trong vòng tiếp theo, trước khi coi course hoàn tất.
- Cloud budget $50/tháng là mục tiêu, không phải hard spending cap; chưa có pricing estimate region-specific và chưa phê duyệt cloud mutations.

## Gate state
- G-L PASS: vi nhất quán hai manifests.
- G0/G1/G2 REVIEWED: dữ liệu đã thống nhất, ADR chờ phê duyệt cuối.
- G3 PASS: structural/schema/DAG.
- G4 PARTIAL: micro labs và tiny starter executed; end-to-end issue implementation unverified.
- G5 NOT APPLICABLE: chưa xuất bản theo yêu cầu.
- G6/G7 BLOCKED: chưa có implementation/project thực tế hoàn chỉnh và cloud permissions.

## Điều kiện trước publication
Đối chiếu issue-scoped code với versioned lockfile, thử clean-room walkthrough, ghi commit SHA và logs. Không chuyển bất kỳ issue nào sang `verified` chỉ vì micro lab chạy thành công.
