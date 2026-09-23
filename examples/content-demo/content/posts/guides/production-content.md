---
title: The same content in production
description: Farm bundles the validated collection into the server output instead of reading source files at request time.
publishedAt: 2026-08-29
tags:
  - Production
  - SSG
---
Development watches the source files and refreshes the page when content changes. Production receives a generated server module containing only validated data.

That makes the same API useful for dynamic rendering, static generation, and deployment targets where the original project files are unavailable.
