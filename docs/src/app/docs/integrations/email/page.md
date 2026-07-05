---
title: "Email Integration"
description: "Render React Email templates, send with Resend, schedule messages, preview templates, and receive webhooks."
section: "Integrations"
---

# Email Integration

Render React Email templates, send with Resend, schedule messages, preview templates, and receive webhooks.

## Define templates

**src/lib/email.ts**

```tsx
import { resend, template } from "@farmjs/integrations/email";

const templates = {
  welcome: template({
    subject: "Welcome to Farm",
    component: ({ name }: { name: string }) => <p>Hello {name}</p>,
  }),
};

export const email = resend({
  apiKey: process.env.RESEND_API_KEY,
  defaults: { from: "hello@example.com" },
  templates,
});
```

## Send mail

**Caller**

```ts
await apiClient.email.send.post({
  body: {
    template: "welcome",
    to: "ada@example.com",
    data: { name: "Ada" },
  },
});
```
