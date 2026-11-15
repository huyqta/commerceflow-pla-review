# GCP sandbox và cost gates

- Budget: 50 USD/tháng là mức dự kiến, không phải spending cap tự động.
- Tạo budget notifications ở 25/50/80/100% nếu người học phê duyệt.
- Bắt đầu local; cloud lab từng phần, GKE dọn ngay sau demonstration.
- Đếm các phụ phí: Cloud SQL uptime, networking/egress, Cloud NAT, LB, Artifact storage, Cloud Logging và DB backups.
- Để giảm chi phí, thử local PostgreSQL trước; nếu Cloud SQL estimate vượt ngân sách, ghi `blocked` và cần điều chỉnh kiến trúc/scope.
- Không chạy gcloud create/deploy hay terraform apply/destroy tự động.
