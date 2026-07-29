# Resend Email Integration Example

Config-first typed email delivery through `@farm.js/email`.

This example wires:

- typed `templateId` and `data` for `apiClient.email.send(...)`
- typed `when` scheduling for `apiClient.email.schedule(...)`
- React Email component templates via `@react-email/components`
- `Component.PreviewProps` flowing through `/api/email/templates` for client-side defaults
- first-class `apiClient.email.schedule({ body: { templateId, data, to, when } })`
- a server `page.tsx` that renders a client child and hydrates automatically because it imports a `"use client"` module
- preview and send routes owned by the integration
- a schedule route owned by the integration
- Resend webhook verification through `/api/email/webhook`

For the current core runtime, keep that page module browser-safe. Server-only reads like `process.env` should stay inside the integration config or route handlers, not in the page module that gets hydrated.

The integration owns:

- `/api/email/send`
- `/api/email/schedule`
- `/api/email/preview`
- `/api/email/templates`
- `/api/email/webhook`

The shared callers are exposed in [api.ts](/Users/mac/oss/farm.js/examples/email-integrations/resend-example/src/lib/api.ts):

- `api` for server-side direct dispatch
- `apiClient` for browser calls through integration-owned routes

The app config lives in [integrations.ts](/Users/mac/oss/farm.js/examples/email-integrations/resend-example/src/lib/integrations.ts).

For scheduling, pass an ISO 8601 string in `when`. The integration maps that to Resend's
`scheduledAt`, and the live provider currently rejects values more than 30 days ahead.

You can also use the helper presets:

```ts
import { emailSchedule } from "@farm.js/email/schedule";

await apiClient.email.schedule({
  body: {
    templateId: "inviteUser",
    to: "person@example.com",
    when: emailSchedule.presets.in1Hour,
    data: {
      orgName: "Acme 01",
      inviteUrl: "https://acme.dev/invite/123",
    },
  },
});

await apiClient.email.schedule({
  body: {
    templateId: "inviteUser",
    to: "person@example.com",
    when: emailSchedule.after.days(1),
    data: {
      orgName: "Acme 01",
      inviteUrl: "https://acme.dev/invite/123",
    },
  },
});

await apiClient.email.schedule({
  body: {
    templateId: "inviteUser",
    to: "person@example.com",
    when: 60 * 60,
    data: {
      orgName: "Acme 01",
      inviteUrl: "https://acme.dev/invite/123",
    },
  },
});
```

To run it:

1. Build the package once: `pnpm build`
2. Start the example: `pnpm --dir examples/email-integrations/resend-example dev`
3. Open [http://localhost:3005](http://localhost:3005)

For a real webhook listener, point Resend or a tunnel at:

- `http://localhost:3005/api/email/webhook`

The webhook route verifies `svix-id`, `svix-timestamp`, and `svix-signature`, then calls your `webhooks.onEvent(...)` handler from the integration config.

If you want dashboard-triggered webhooks from Resend, expose the local server with a tunnel and set `RESEND_WEBHOOK_SECRET` in `.env.local`.
