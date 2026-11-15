#!/usr/bin/env python3
# Chỉ kiểm tra file tài liệu tồn tại và có nội dung; không thay thế review semantic.
import pathlib,sys
if len(sys.argv)!=2: raise SystemExit('usage: python3 scripts/validate_docs.py <path>')
p=pathlib.Path(sys.argv[1]); assert p.is_file() and len(p.read_text().strip())>30, f'file missing/empty: {p}'
print('DOC_SMOKE_OK',p)
