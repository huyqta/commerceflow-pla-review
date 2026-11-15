# Failure drills

- DB unavailable during Outbox poll -> retry after recovery without duplicated charge.
- Pub/Sub duplicate delivery -> inbox dedupes.
- Payment failed -> Saga compensation releases stock.
- Cloud Run revision error -> rollback previous image digest.
- GKE restart -> probes/rollout/teardown audit.

Tất cả đang **chưa chạy**, cần log/commit/exit code.
