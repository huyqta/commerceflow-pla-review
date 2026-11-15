# CommerceFlow — PLA v1.2 review package

**Trạng thái:** Chờ duyệt, chưa publish GitHub, chưa provision Google Cloud.

**Ngôn ngữ:** Tiếng Việt (vi) · **Trình độ:** Intermediate · **16 tuần / ~160 giờ** · **Guided** · **40 Issues** · **Cloud budget đề xuất:** 50 USD/tháng.

## Review trước khi publish
1. `pla/project-spec.yaml`: phạm vi, quyết định và rủi ro.
2. `pla/roadmap.json`: 40 Issues, dependency DAG, acceptance criteria.
3. `docs/adr/`: 9 ADRs để review.
4. `issues/CF-001.md` → `CF-040.md`: hướng dẫn có micro-lab đã chú thích; phần full application implementation vẫn là bài tập, không được xem đã hoàn thành.
5. `starter/`: runnable tiny TypeScript domain starter; `reference-plan/` chỉ là kế hoạch.
6. `evidence/`: logs thật, không nâng status khi thiếu full integration evidence.

## Chạy kiểm tra khi đã tải về
```bash
python3 scripts/validate_roadmap.py pla/roadmap.json --strict
python3 scripts/validate_docs.py docs/requirements.md
node --experimental-strip-types --test starter/tests/*.test.ts
node labs/CF-021/demo.mjs
```

**Lưu ý:** Không có NestJS full application, Cloud Run deployment hoặc GKE live cluster trong package này. Issue code là ví dụ micro-lab độc lập, các bài end-to-end cần implementation và clean-room verification thêm trước khi publish như ready-to-run.
