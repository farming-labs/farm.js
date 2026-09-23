---
title: Schema-first publishing
description: Turn malformed frontmatter into a clear build error instead of a broken production page.
publishedAt: 2026-09-04
tags:
  - Type safety
  - Zod
---
Writers keep working in Markdown while the application keeps its data contract. A missing title, invalid date, or incorrect field points back to the collection and source file.

Transforms run after validation, so computed values such as reading time remain typed everywhere they are consumed.
