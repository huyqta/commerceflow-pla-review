# Runbook bản nháp

1. Xác minh lỗi bằng `correlationId`, không log token hoặc dữ liệu cá nhân.
2. Xem Cloud Run revision, readiness, Pub/Sub DLQ và saga transitions.
3. Nếu lỗi deploy, rollback revision theo digest; không tạo thanh toán thật.
4. Nếu event duplicated, kiểm tra inbox/eventId và transaction idempotency.
5. Sau cloud lab, kiểm kê Cloud SQL, GKE, IP/LB, Artifact Registry, Pub/Sub resources và kiểm tra billing.

Bài CF-038–040 sẽ điền evidence; đây chưa phải runbook production đã test.
