---
title: "UI Registry"
description: "Opt into shadcn-style UI scaffolds for built-in integrations when you want working screens with the integration setup."
section: "Integrations"
---

# UI Registry

Opt into shadcn-style UI scaffolds for built-in integrations when you want working screens with the integration setup.

## Add integration UI

Farm's CLI can install integration wiring only, or include UI with --ui. The UI registry is opt-in so teams that already have a design system can keep their app clean.

**Terminal**

```bash
farm add integration stripe --ui
farm add integration better-auth --ui
farm add integration jobs-trigger --ui
```

## Registry principles

- Base components follow shadcn conventions.
- Feature registries are grouped by provider, such as billing, auth, jobs, email, AI, and API keys.
- Generated files are app-owned, so users can edit the UI after installation.
