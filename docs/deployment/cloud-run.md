# Cloud Run deployment — kế hoạch, chưa thực hiện

1. Review estimate, sandbox project, IAM least privilege và domain ingress.
2. Terraform plan, xét thay đổi và yêu cầu approval.
3. Deploy image bằng digest, đặt min instances=0 phù hợp workload.
4. Pub/Sub push dùng service account với `roles/run.invoker` và verify audience/token; không expose internal callback tùy tiện.
5. Dùng Workload Identity Federation cho GitHub Actions, không lưu service-account key JSON.
6. Test health, order end-to-end, failure, log trace, rollback revision.
7. Resource inventory và cleanup cloud; ghi billing observation.
