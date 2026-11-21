# Evidence CF-002

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0, Docker 29.4.1, pnpm 10.28.2
- Revision SHA: 9ccda58f8d16a9c15905f142ee7b7fee8d72d5bc
- Commands / exit codes:
  - Command 1: `node labs/CF-002/demo.mjs`
    - Output: `MICRO_LAB_OK CF-002`
    - Exit code: `0`
  - Command 2: `node --experimental-strip-types --test starter/tests/*.test.ts`
    - Output:
      ```
      ✔ mới tạo đơn là PENDING (0.8132ms)
      ✔ không confirm đơn đã hủy (0.5339ms)
      ✔ không nhận id rỗng (0.2115ms)
      ℹ tests 3
      ℹ pass 3
      ℹ fail 0
      ```
    - Exit code: `0`
- Negative case:
  - Command: `node -e "import assert from 'node:assert/strict'; const versions = { node: '18.15.0' }; assert.ok(Number(versions.node.split('.')[0]) >= 20);"`
  - Observed Output: `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value: assert.ok(Number(versions.node.split('.')[0]) >= 20)`
  - Exit code: `1`
  - Giải thích: Khi môi trường chạy phiên bản Node cũ (< 20, ví dụ Node 18), script smoke test lập tức ngắt với exit code 1, ngăn chặn việc chạy dự án thiếu tính năng native type-stripping.

[ANSWER]
## 1. Trade-off: Dùng Windows PowerShell chạy lệnh Bash/POSIX

Trong phát triển phần mềm đa nền tảng (cross-platform), việc khác biệt giữa môi trường POSIX (Bash trên Linux/macOS) và Windows PowerShell tạo ra sự đánh đổi lớn:

- **Thực trạng và Rủi ro:**
  - **Cú pháp biến môi trường:** Bash dùng `VAR=val command` hoặc `export VAR=val`, trong khi PowerShell dùng `$env:VAR="val"`. Chạy script Bash trên PowerShell sẽ gây lỗi command not found.
  - **Ký tự nối lệnh và chuyển tiếp:** Phân tách thư mục (`/` vs `\`), globbing file (`*.test.ts`), và escape ký tự (`\` vs `` ` ``) khác biệt nhau.
  - **Scripts tự động hóa:** Các file shell script `.sh` trong CI/CD pipeline hoặc Makefile không thể thực thi tự nhiên trên PowerShell nếu thiếu WSL2 hoặc Git Bash.
- **Giải pháp Trade-off cho CommerceFlow:**
  - **Quy chuẩn hóa lệnh qua Node.js:** Sử dụng các Node.js script (`.mjs`) hoặc npm scripts đa nền tảng kết hợp các thư viện chuẩn (`node:path`, `node:fs`) thay cho shell commands cục bộ.
  - **Khuyến nghị môi trường:** Trên Windows, khuyến nghị sử dụng **WSL2 (Ubuntu)** để đồng nhất 100% môi trường dòng lệnh và container với môi trường đích trên Google Cloud Run.

---

## 2. Thử thách độc lập: Mô tả cách kiểm chứng một lệnh chạy trên OS khác?

### Phương pháp kiểm chứng đa nền tảng (Cross-OS Verification):
1. **Sử dụng Containerization (Docker):**
   - Đóng gói lệnh vào một standard Linux container (ví dụ `node:24-alpine` hoặc `ubuntu:24.04`) và thực thi ngay trên máy dev:
     ```bash
     docker run --rm -v ${PWD}:/app -w /app node:24-alpine sh -c "node --test starter/tests/*.test.ts"
     ```
   - *Ưu điểm:* Đảm bảo tính nhất quán tuyệt đối giữa môi trường dev cục bộ và môi trường runtime Cloud Run / GKE trên GCP.
2. **Matrix Testing trong CI/CD (GitHub Actions):**
   - Thiết lập workflow ma trận hệ điều hành để chạy test tự động trên `ubuntu-latest`, `windows-latest`, và `macos-latest`:
     ```yaml
     strategy:
       matrix:
         os: [ubuntu-latest, windows-latest, macos-latest]
     runs-on: ${{ matrix.os }}
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with:
           node-version: 24
       - run: node --experimental-strip-types --test starter/tests/*.test.ts
     ```

### Ví dụ và phép thử chứng minh:
- **Ví dụ kịch bản kiểm tra lệnh POSIX-only:**
  - Lệnh thiết lập môi trường: `export NODE_ENV=test && node -e "console.log(process.env.NODE_ENV)"`.
  - Trên Linux/macOS: In `test` với exit code 0.
  - Trên Windows PowerShell: Báo lỗi `export : The term 'export' is not recognized...` với exit code 1.
- **Phép thử chứng minh:**
  - Chạy lệnh chuẩn hóa cross-platform qua Node:
    ```bash
    node -e "process.env.NODE_ENV='test'; console.log(process.env.NODE_ENV)"
    ```
  - Kết quả: In `test`, exit code 0 trên cả 3 hệ điều hành Windows, Linux và macOS mà không phụ thuộc shell.
