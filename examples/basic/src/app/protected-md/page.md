---
title: Protected Markdown Page
description: A markdown-authored page used to verify middleware guards its .md source.
---

# Protected markdown page

PROTECTED_MARKDOWN_SECRET_BODY

This page is authored as `src/app/protected-md/page.md`. Middleware redirects both
`/protected-md` and its raw source at `/protected-md.md` to a login route, so the
source must never be served without the middleware running first.
