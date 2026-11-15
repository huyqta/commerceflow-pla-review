# Reference Track — kế hoạch, chưa tạo solution

- Tạo repository riêng có quyền truy cập hạn chế chỉ khi user phê duyệt, không đẩy solution branch vào public learner repo.
- Mỗi Issue có revision SHA/commit riêng với command logs và environment manifest; freeze lockfile.
- Kiểm chứng theo DAG từ clean clone, từng Issue phải pass toàn bộ acceptance riêng mới được nâng `verified`.
- Giai đoạn hiện tại chỉ có learner starter + micro-lab, không có complete reference implementation.
- Ưu tiên reference từ CF-001 đến CF-016 trước; tiếp đến messaging Saga và cloud track sau khi có permission và môi trường tương thích.
