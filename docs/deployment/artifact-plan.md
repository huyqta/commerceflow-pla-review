# Image provenance plan

- Docker image tag phải chứa git SHA, chỉ deploy bằng digest để tái lập.
- GitHub Actions chỉ cần `contents: read`, `id-token: write` cho job federation khi cần.
- Artifact Registry push sau khi có approval và GCP identity.
- Dùng rollback digest trước, sau đó review DB migration compatibility.
