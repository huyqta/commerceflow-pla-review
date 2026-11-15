# Extraction plan

1. Baseline modular monolith: chạy use cases và integration tests trước khi tách.
2. Tách Catalog và Inventory, giao tiếp API/event contract rõ ràng.
3. Tách Ordering/Payments với data owner riêng, không cross-schema query.
4. Dual-run chỉ trong lab với dữ liệu synthetic; đối chiếu behavior và rollback bằng image revision.
5. Không dùng shared ORM models làm service API contract.
