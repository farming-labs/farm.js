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

## What gets generated

The registry is integration-aware. A billing integration can generate pricing cards, checkout buttons, portal buttons, billing-status panels, and entitlement banners. An auth integration can generate sign-in pages, sign-up pages, session buttons, account menus, and protected dashboard shells. Jobs and API-key integrations can generate task dashboards, run-status views, and key-management screens.

The CLI keeps UI optional:

```bash
farm add integration stripe
farm add integration stripe --ui
```

Without `--ui`, Farm installs wiring only. With `--ui`, it adds app-owned components that already call the typed integration API.

## Example generated usage

```tsx
"use client";

import { apiClient } from "../lib/api";

export function CheckoutButton() {
  async function checkout() {
    const result = await apiClient.billing.checkout.post({
      body: {
        productId: "pro",
        successPath: "/dashboard",
        cancelPath: "/pricing",
      },
    });

    if (result.data?.redirectTo) {
      window.location.href = result.data.redirectTo;
    }
  }

  return <button onClick={checkout}>Upgrade</button>;
}
```

## Customizing registry output

- Generated files live in the app, so teams can edit them after installation.
- Keep provider SDK secrets out of generated client components.
- Prefer small components that call typed APIs over large opaque templates.
- Use existing design-system primitives when the app already has them.
- Keep registry output deterministic so repeated installs are reviewable.

## Production notes

- Generate UI only for flows the app plans to own.
- Review generated files before shipping.
- Keep route names and product IDs stable so generated components do not drift.
- Add tests around the resulting user flow, not just the generated component.
