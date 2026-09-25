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
import { resend, template } from "@farm.js/email";

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
  // Required: the mounted routes spend your Resend credits.
  authorize: async (request) => Boolean(await getSessionUser(request)),
});
```

## Choose SDK ownership

### Let Farm construct Resend

The example above is the default path. When `instance` is omitted, Farm creates the Resend SDK from
`apiKey`, supplied directly or through `RESEND_API_KEY`.

### Provide an application-owned instance

```tsx
import { Resend } from "resend";
import { resend } from "@farm.js/email";

const resendClient = new Resend(process.env.RESEND_API_KEY);

export const email = resend({
  instance: resendClient,
  defaults: { from: "hello@example.com" },
  templates,
});
```

The instance wins if an API key is also supplied. Templates, defaults, scheduling, previews,
routes, and webhooks remain integration options in either mode.

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

| Area            | Details                                                                               |
| --------------- | ------------------------------------------------------------------------------------- |
| Templates       | Typed React Email templates with subjects, preview text, defaults, and preview props. |
| Send            | A typed `send` route for transactional messages.                                      |
| Schedule        | A typed route for future delivery.                                                    |
| Preview         | HTML and text rendering for local previews or admin tools.                            |
| Templates index | A route that lists configured templates and preview metadata.                         |
| Webhooks        | Optional Resend webhook receivers for delivery events.                                |

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

## Authorize the routes

Configuring the integration mounts `POST /api/email/send`, `/schedule`, and `/preview` under your
app's own origin. Those routes spend your Resend credits and send from your verified domain, so
they refuse anonymous callers: without `authorize` they answer `401` and nothing is sent.

`authorize` receives the request and the route being called. Return `true` to allow, `false` for a
generic `401`, or a `Response` to answer the caller yourself.

```ts
export const email = resend({
  apiKey: process.env.RESEND_API_KEY,
  templates,
  authorize: async (request, { route }) => {
    const user = await getSessionUser(request);
    if (!user) return false;
    // Only staff may schedule campaigns; any signed-in user may send.
    return route === "schedule" ? user.isStaff : true;
  },
});
```

Farm also rejects cross-site callers before `authorize` runs, so a session-cookie check cannot be
turned into a forged send by another site. Add extra trusted origins with `allowedOrigins`, using
the same syntax as `serverActions.allowedOrigins`.

If the base path is already gated by your own middleware or at the edge, opt out explicitly:

```ts
resend({ templates, allowUnauthenticated: true });
```

Recipients, sender, and template data still come from the request body, so `authorize` is where you
decide who may address mail to whom. Email headers are not caller-controlled: they come from your
template and `defaults` configuration.

## Production notes

- Set `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL`.
- Use idempotency keys for important transactional flows.
- Preview templates in development before sending them to real recipients.
- Keep template IDs stable because they are part of the caller contract.
- Verify webhooks before using delivery events for product logic.
