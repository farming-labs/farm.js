# @farm.js/email

Transactional email for Farm.js applications, sent through Resend. Templates are React components
registered under typed ids, and the integration mounts routes to send, schedule, and preview them,
list them, and receive Resend webhooks.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/email
```

`resend` and `@react-email/render` are dependencies, and `react` is a peer dependency. To scaffold
the registry entry and an email console at `/integrations/resend` in an existing app, run
`farm add integration resend --ui`.

## Configure

```ts
// src/lib/integrations.ts
import { resend, template } from "@farm.js/email";
import { WelcomeEmail } from "../emails/welcome";
import { getUser } from "./session";

export const appIntegrations = {
  email: resend({
    defaults: { from: "Acme <hello@acme.dev>" },
    templates: {
      welcome: template(WelcomeEmail, {
        subject: ({ name }) => `Welcome, ${name}`,
      }),
    },
    async authorize(request) {
      return Boolean(await getUser(request));
    },
  }),
} as const;
```

`template(Component, config)` takes the component first, so `data` is typed from its props. The
config sets `subject` and may set `previewText`, `from`, and `replyTo`, each a value or a function
of the data.

| Variable                | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `RESEND_API_KEY`        | Builds the Resend client. Required unless `instance` or `apiKey` is set. |
| `RESEND_FROM_EMAIL`     | Default sender when a template and `defaults.from` set none.             |
| `RESEND_REPLY_TO_EMAIL` | Default reply-to address.                                                |
| `RESEND_WEBHOOK_SECRET` | Default secret for the webhook route.                                    |

Sending fails without a sender from the template, `defaults.from`, or `RESEND_FROM_EMAIL`.

## Who can send

The send, schedule, and preview routes spend the app's Resend credits and send from its verified
domain, so they refuse anonymous callers.

- Pass `authorize(request, { route })`. Return `true` to allow, `false` for `401`, or a `Response`.
- Without `authorize`, the routes answer `401` unless `allowUnauthenticated: true` is set, which is
  only for apps that already gate the base path in middleware.
- Requests from other origins get `403` unless listed in `allowedOrigins`.
- Callers cannot set `from`, `replyTo`, `cc`, `bcc`, `attachments`, `tags`, or `topicId` unless
  `allowCallerHeaders: true` is set. `to` always comes from the caller, so check it in `authorize`.

## Send and schedule

Call the routes through `apiClient` or `api` from `createIntegrations` in `@farm.js/core/client`.

```ts
const sent = await apiClient.email.send({
  body: { templateId: "welcome", to: "ada@example.com", data: { name: "Ada" } },
});
```

```ts
import { emailSchedule } from "@farm.js/email/schedule";

await apiClient.email.schedule({
  body: {
    templateId: "welcome",
    to: "ada@example.com",
    data: { name: "Ada" },
    when: emailSchedule.after.minutes(30),
  },
});
```

`when` accepts a `Date`, a number of seconds from now, an `emailSchedule` delay or preset, or a
string, which is passed to Resend as is.

## Routes

| Route                      | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `POST /api/email/send`     | Render and send a template.                                    |
| `POST /api/email/schedule` | Render and schedule a template.                                |
| `POST /api/email/preview`  | Render a template without sending it.                          |
| `GET /api/email/templates` | List template ids and preview props. Not gated by `authorize`. |
| `POST /api/email/webhook`  | Verify a Resend event and call `onEvent`.                      |

`basePath` moves them all. The webhook route mounts only when `webhooks` is set, with its secret
defaulting to `RESEND_WEBHOOK_SECRET`. A failed verification gets `400`, and `onError` can return a
response of its own.

## Entry points

`@farm.js/email/client` exports `template`, `resendClient`, `createResendClientApi`, and the types
without loading the Resend SDK. `@farm.js/email/schedule` exports `emailSchedule` on its own.

## Documentation

- [Email integration](https://farmjs.dev/docs/integrations/email)
- [`examples/email-integrations/resend-example`](https://github.com/farming-labs/farm.js/tree/main/examples/email-integrations/resend-example)

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
