---
title: "Resend Integration"
description: "Render React Email templates, send with Resend, schedule messages, preview templates, and receive webhooks."
section: "Integrations"
---

# Resend Integration

Render React Email templates, send with Resend, schedule messages, preview templates, and receive webhooks.

## Define templates

**src/lib/email.ts**

```tsx
import { resend, template } from "@farm.js/integrations/email";

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

## What Resend adds

| Area | Details |
| --- | --- |
| Templates | Typed React Email templates with subjects, preview text, defaults, and preview props. |
| Send | A typed `send` route for transactional messages. |
| Schedule | A typed route for future delivery. |
| Preview | HTML and text rendering for local previews or admin tools. |
| Templates index | A route that lists configured templates and preview metadata. |
| Webhooks | Optional Resend webhook receivers for delivery events. |

## Preview before sending

```ts
const preview = await api.email.preview.post({
  body: {
    templateId: "welcome",
    data: {
      name: "Ada",
    },
  },
});

console.log(preview.data?.subject);
console.log(preview.data?.html);
```

## Schedule mail

```ts
await api.email.schedule.post({
  body: {
    templateId: "welcome",
    to: "ada@example.com",
    when: "tomorrow 9am",
    data: {
      name: "Ada",
    },
  },
});
```

## Template defaults

Templates can supply their own `subject`, `previewText`, `from`, and `replyTo`. The integration also supports global defaults, which keeps common sender details out of every call.

```tsx
const templates = {
  invite: template({
    subject: ({ workspace }: { workspace: string }) => `Join ${workspace}`,
    previewText: "You were invited to collaborate.",
    component: ({ workspace }: { workspace: string }) => <p>Join {workspace}</p>,
  }),
};
```

## Production notes

- Set `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL`.
- Use idempotency keys for important transactional flows.
- Preview templates in development before sending them to real recipients.
- Keep template IDs stable because they are part of the caller contract.
- Verify webhooks before using delivery events for product logic.
