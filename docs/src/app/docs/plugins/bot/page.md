---
title: "Bot Protection"
description: "Stop bots at your forms with Turnstile, hCaptcha, reCAPTCHA, or your own checker, verified on the server for every submission."
section: "Plugin Ecosystem"
---

# Bot Protection

`@farm.js/bot` stops bots at your forms. The check runs in the browser and every submission
is verified on the server, so a form that skips the check is refused. Secrets stay on the
server, and your `security.csp` is updated for the provider you pick.

It works with any checker. `@farm.js/bot/captcha` has Turnstile, hCaptcha, and reCAPTCHA, and
you can write your own in a few lines. Provider code you don't import stays out of your bundle.

It doesn't rate limit, block IPs, or decide what to do with a suspicious visitor. It answers
one question for one submission.

## Install

```bash
pnpm add @farm.js/bot
```

## Complete example

Add the plugin with the provider you want:

**farm.config.ts**

```ts
import { bot } from "@farm.js/bot";
import { turnstile } from "@farm.js/bot/captcha";
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  plugins: [bot({ provider: turnstile() })],
});
```

Show the check inside the form:

**src/app/signup/page.tsx**

```tsx
import { useRef, useState, type FormEvent } from "react";
import { BotCheck, type BotCheckHandle } from "@farm.js/bot/react";

export default function SignupPage() {
  const check = useRef<BotCheckHandle>(null);
  const [verified, setVerified] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await fetch("/api/signup", { method: "POST", body: new FormData(event.currentTarget) });
    // Tokens are single-use, so every attempt needs a new one.
    setVerified(false);
    check.current?.reset();
  }

  return (
    <form onSubmit={submit}>
      <input name="email" type="email" required />
      <BotCheck
        ref={check}
        onVerify={() => setVerified(true)}
        onExpire={() => setVerified(false)}
      />
      <button disabled={!verified}>Sign up</button>
    </form>
  );
}
```

Verify on the server. `verifyBot` works the same in API routes and server actions:

**src/app/api/signup/route.ts**

```ts
import { verifyBot } from "@farm.js/bot/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const check = await verifyBot(form);

  if (!check.success) {
    return Response.json({ error: check.message }, { status: check.status });
  }

  // Create the account.
  return Response.json({ ok: true });
}
```

## Options

```ts
bot({
  provider: turnstile(),
  hostnames: ["shop.example.com"],
  timeoutMs: 3000,
});
```

| Option      | Default                | Description                          |
| ----------- | ---------------------- | ------------------------------------ |
| `provider`  | Required               | The checker to use.                  |
| `hostnames` | The request's hostname | The hostnames a check may come from. |
| `timeoutMs` | `5000`                 | How long to wait for the provider.   |

## Captchas

| Provider      | Site key             | Secret key             |
| ------------- | -------------------- | ---------------------- |
| `turnstile()` | `TURNSTILE_SITE_KEY` | `TURNSTILE_SECRET_KEY` |
| `hcaptcha()`  | `HCAPTCHA_SITE_KEY`  | `HCAPTCHA_SECRET_KEY`  |
| `recaptcha()` | `RECAPTCHA_SITE_KEY` | `RECAPTCHA_SECRET_KEY` |

Each takes `{ siteKey, secretKey, testKeys }`.

In development they work with no keys, on the service's always-passing test keys. A production
build needs the site key and the server needs the secret. Both fail with a message naming the
variable when they're missing. A built server never uses test keys unless you pass
`testKeys: true`, for a staging deployment.

## What comes back

```ts
| { success: true,  provider, hostname, testKeys, data }
| { success: false, provider, code, message, status, providerCodes }
```

`message` is safe to show. `status` is 403, or 503 when the provider can't be reached. `code`
is one of `missing_token`, `rejected`, `expired`, `hostname_mismatch`, or `unavailable`.

A configuration mistake, such as a missing or wrong key, is your bug and not the visitor's, so
it throws a `BotError` and the submission fails.

`verifyBot` also takes a token string, for a JSON API.

## Other renderers

| Renderer | Import                | Reset                         |
| -------- | --------------------- | ----------------------------- |
| React    | `@farm.js/bot/react`  | `ref` gives `{ reset() }`     |
| Preact   | `@farm.js/bot/preact` | `ref` gives `{ reset() }`     |
| Vue      | `@farm.js/bot/vue`    | template `ref` gives `reset`  |
| Solid    | `@farm.js/bot/solid`  | `ref` callback                |
| Svelte   | `@farm.js/bot/svelte` | `ref` in the action's options |

Svelte uses an action: `<div use:botCheck={{ onVerify }}></div>`. Pass `settings` for anything
specific to a provider, such as `{ size: "compact" }`.

## Write your own checker

A checker is a plain object. `name` and `verify` are all it needs:

```ts
import { defineBotProvider } from "@farm.js/bot";

export const honeypot = defineBotProvider({
  name: "honeypot",
  async verify({ form }) {
    return form?.get("website") ? { success: false, code: "rejected" } : { success: true };
  },
});
```

`verify` receives `{ token, form, request, remoteIp, signal }`. Farm reads the token, enforces
`timeoutMs`, refuses a hostname that isn't yours when you report one, writes the visitor's
message, and refuses anything that isn't a valid verdict. Throw only for a configuration mistake.

For browser code, name an ordinary module in `client`. Call `onVerify(token)` from it and Farm
puts the token in the form under `tokenField`:

```ts
// src/acme.ts
export const acme = defineBotProvider({
  name: "acme",
  tokenField: "acme-token",
  client: () => ({ widget: "/src/acme.widget.ts", public: { minMs: 800 } }),
  async verify({ token }) {
    return token === "ok" ? { success: true } : { success: false, code: "rejected" };
  },
});
```

```ts
// src/acme.widget.ts
import { defineBotWidget } from "@farm.js/bot/client";

export default defineBotWidget<{ minMs: number }>(({ minMs }) => ({
  mount(_element, { onVerify }) {
    const timer = setTimeout(() => onVerify("ok"), minMs);
    return { reset() {}, remove: () => clearTimeout(timer) };
  },
}));
```

A published checker names its widget by package path, such as `acme-bot/widget`. Inside an app,
use a path from the app root, as above.

`createBotKeys` gives your checker the same key options and safety as the captcha providers. A
service with a script widget and a siteverify endpoint is only a description, with
`createSiteverifyProvider` from `@farm.js/bot/captcha`. The package
[README](https://github.com/farming-labs/farm.js/tree/main/packages/farm-bot) has both, and
`checkBotProvider` from `@farm.js/bot/testing` reports every way a checker breaks the contract.

For a typed `check.data`, keep the plugin in a variable, add it to `plugins`, and call its
`verify`, because `verifyBot` can't see your provider's types.

## Limits

- **`rsc` mode.** Farm doesn't run plugins there yet, so the widget never starts by itself and
  `verifyBot` throws a `BotError` that says so. `islands` mode works.
- **Cloudflare Pages with `@farm.js/core` 0.1.66 or earlier.** That output exposes no bindings
  at runtime, so secrets aren't found and every check fails with a `BotError`. Upgrade core, or
  use compatibility date `2025-04-01` or later, the `cloudflare-module` preset, or pass
  `secretKey`.
- **reCAPTCHA** means the v2 checkbox. v3 has no widget, so it needs its own provider.
- **One checker per app.** The plugin can be added once, so two forms can't use two different
  checkers.
- **A checker can't add routes.** One that issues challenges from the server needs a route in
  the app for it.
- **A checker with no browser half has no `<BotCheck>`.** Leave the component out, or nothing
  tells the page it passed.
- **The hostname check** relies on the provider's report, which test keys don't give. By default
  it compares against the request's host, which a client can set on a server it reaches
  directly. Set `hostnames` for a Node server without a proxy that fixes the host, or behind one
  that rewrites it. Each provider's own domain allowlist still applies.
