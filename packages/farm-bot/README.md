# @farm.js/bot

**Stop bots at your forms, with any checker.**

The check runs in the browser and every submission is verified on the server. A form that skips the check is refused. Your `security.csp` is updated for the provider you pick.

The core knows no vendor. A provider tells it how a checker works. `@farm.js/bot/captcha` has Turnstile, hCaptcha, and reCAPTCHA, and you can write your own in a few lines. They add no dependencies, and code you don't import stays out of your bundle.

It doesn't rate limit, block IPs, or decide what to do with a suspicious visitor. It answers one question for one submission.

## Use it

```ts
// farm.config.ts
import { bot } from "@farm.js/bot";
import { turnstile } from "@farm.js/bot/captcha";
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  plugins: [bot({ provider: turnstile() })],
});
```

```tsx
// inside the form
import { BotCheck } from "@farm.js/bot/react";

<BotCheck onVerify={() => setVerified(true)} />;
```

```ts
// src/app/api/signup/route.ts
import { verifyBot } from "@farm.js/bot/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const check = await verifyBot(form);

  if (!check.success) {
    return Response.json({ error: check.message }, { status: check.status });
  }

  // Create the account.
}
```

| Option      | Default                | What it does                        |
| ----------- | ---------------------- | ----------------------------------- |
| `provider`  | Required               | The checker to use                  |
| `hostnames` | The request's hostname | The hostnames a check may come from |
| `timeoutMs` | `5000`                 | How long to wait for the provider   |

## What comes back

```ts
| { success: true,  provider, hostname, testKeys, data }
| { success: false, provider, code, message, status, providerCodes }
```

`message` is safe to show. `status` is 403, or 503 when the provider can't be reached. `code` is one of `missing_token`, `rejected`, `expired`, `hostname_mismatch`, or `unavailable`.

A configuration mistake, such as a missing or wrong key, is your bug and not the visitor's, so it throws a `BotError` and the submission fails.

`verifyBot` also takes a token string, for a JSON API. It works in API routes and server actions.

## Captchas

```ts
import { hcaptcha, recaptcha, turnstile } from "@farm.js/bot/captcha";
```

| Provider      | Site key             | Secret key             |
| ------------- | -------------------- | ---------------------- |
| `turnstile()` | `TURNSTILE_SITE_KEY` | `TURNSTILE_SECRET_KEY` |
| `hcaptcha()`  | `HCAPTCHA_SITE_KEY`  | `HCAPTCHA_SECRET_KEY`  |
| `recaptcha()` | `RECAPTCHA_SITE_KEY` | `RECAPTCHA_SECRET_KEY` |

Each takes `{ siteKey, secretKey, testKeys }`.

In development they work with no keys, on the service's always-passing test keys. A production build needs the site key and the server needs the secret. Both fail with a message naming the variable when they're missing. A built server never uses test keys unless you pass `testKeys: true`, for a staging deployment.

Any other service with a script widget and a siteverify endpoint is a description. These three are built this way.

```ts
import { createSiteverifyProvider } from "@farm.js/bot/captcha";

export const acme = (keys?: BotProviderKeys) =>
  createSiteverifyProvider(
    {
      name: "acme",
      tokenField: "acme-response",
      verifyUrl: "https://api.acme.dev/siteverify",
      widget: { scriptUrl: "https://js.acme.dev/api.js", global: "acme" },
      siteKeyEnv: "ACME_SITE_KEY",
      secretKeyEnv: "ACME_SECRET_KEY",
      csp: { "script-src": ["https://js.acme.dev"] },
    },
    keys,
  );
```

The script must offer `render(element, options)`, `reset(id)`, and optionally `remove(id)`, and call `options.callback(token)`.

## Other renderers

| Renderer | Import                | Reset                         |
| -------- | --------------------- | ----------------------------- |
| React    | `@farm.js/bot/react`  | `ref` gives `{ reset() }`     |
| Preact   | `@farm.js/bot/preact` | `ref` gives `{ reset() }`     |
| Vue      | `@farm.js/bot/vue`    | template `ref` gives `reset`  |
| Solid    | `@farm.js/bot/solid`  | `ref` callback                |
| Svelte   | `@farm.js/bot/svelte` | `ref` in the action's options |

Svelte uses an action: `<div use:botCheck={{ onVerify }}></div>`. Anything else can call `mountBotCheck(element, options)` from `@farm.js/bot/client`.

Tokens are single-use, so call `reset()` after a submit that fails. Pass `settings` for anything specific to a provider, such as `{ size: "compact" }`.

## Write your own checker

A checker is a plain object. `name` and `verify` are all it needs.

```ts
import { defineBotProvider } from "@farm.js/bot";

export const honeypot = defineBotProvider({
  name: "honeypot",
  async verify({ form }) {
    return form?.get("website") ? { success: false, code: "rejected" } : { success: true };
  },
});

// farm.config.ts: plugins: [bot({ provider: honeypot })]
```

`verify` receives `{ token, form, request, remoteIp, signal }` and returns `{ success: true, data }` or `{ success: false, code }`.

`verifyBot` can't see your provider's types, so `check.data` is `unknown`. For a typed `check.data`, keep the plugin in a variable, add it to `plugins`, and call its `verify`:

```ts
// src/bot.ts
export const protection = bot({ provider: acme() });

// farm.config.ts: plugins: [protection]
// your route:     const check = await protection.verify(form);
```

Farm handles the rules you shouldn't have to repeat. It reads the token, enforces `timeoutMs`, refuses a hostname that isn't yours when you report one, writes the visitor's message, and refuses anything that isn't a valid verdict. Throw only for a configuration mistake.

| Your checker                                   | What you write                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| Runs on the server only                        | `verify`                                                                   |
| Has browser code                               | `verify`, `client`, and a widget module                                    |
| Has browser code but draws nothing             | The same, with a widget that returns nothing                               |
| A captcha script with `render` and its own API | `verify`, and `widget: "@farm.js/bot/captcha/widget"`                      |
| A captcha script and a siteverify endpoint     | A description, with `createSiteverifyProvider` from `@farm.js/bot/captcha` |
| An existing provider with one more rule        | `{ ...turnstile(), verify }`, calling the original `verify`                |

### Add browser code

Name a module in `client`. It's an ordinary file, so it can import anything and use its own variables. Secrets stay in the server half.

```ts
// src/acme.ts
import { createBotKeys, defineBotProvider, type BotProviderKeys } from "@farm.js/bot";

export function acme(options?: BotProviderKeys) {
  const keys = createBotKeys(
    { name: "acme", siteKeyEnv: "ACME_SITE_KEY", secretKeyEnv: "ACME_SECRET_KEY" },
    options,
  );

  return defineBotProvider({
    name: "acme",
    tokenField: "acme-token",
    csp: { "script-src": ["https://js.acme.example"] },
    client: () => ({ widget: "/src/acme.widget.ts", public: { siteKey: keys.siteKey() } }),

    async verify({ token, signal }) {
      const secret = keys.secretKey().value;
      try {
        const response = await fetch("https://api.acme.example/check", {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
          body: token,
          signal,
        });
        if (!response.ok) return { success: false, code: "unavailable" };
        const { human, score } = await response.json();
        return human ? { success: true, data: { score } } : { success: false, code: "rejected" };
      } catch {
        return { success: false, code: "unavailable" };
      }
    },
  });
}
```

```ts
// src/acme.widget.ts
import { defineBotWidget, loadBotScript } from "@farm.js/bot/client";

export default defineBotWidget<{ siteKey: string }>(({ siteKey }) => ({
  async mount(element, { onVerify, onExpire, onError }) {
    const api = await loadBotScript<AcmeApi>("https://js.acme.example/v1.js", { global: "acme" });
    const id = api.render(element, { siteKey, done: onVerify, expired: onExpire, failed: onError });
    return { reset: () => api.reset(id), remove: () => api.remove(id) };
  },
}));
```

Call `onVerify(token)` and Farm puts the token in the form under `tokenField`, and takes it out again on `onExpire`, `reset`, and `remove`. A published checker names its widget by package path, such as `acme-bot/widget`. Inside an app, use a path from the app root, as above.

`createBotKeys` gives your checker the same key options and safety as the ones in `@farm.js/bot/captcha`. It takes `{ siteKey, secretKey, testKeys }`, reads Cloudflare bindings as well as `process.env`, and refuses a test key in production. Prefer it to reading `process.env` in `verify`, which finds nothing on some Workers.

`examples/bot-demo/src/time-trap.ts` is a complete checker with its own browser code.

### Test it

```ts
import { checkBotProvider } from "@farm.js/bot/testing";
import acmeWidget from "./acme.widget";

expect(
  await checkBotProvider(acme({ secretKey: "my-secret" }), {
    secrets: ["my-secret"],
    widget: acmeWidget,
  }),
).toEqual([]);
```

It returns every problem as a sentence: a secret in the browser config, a `verify` that accepts a bad token, a widget that leaves elements behind when it's removed. The providers in `@farm.js/bot/captcha` pass it. Pass `widget` only for code you can run in a DOM such as jsdom, and stub `fetch` if `verify` calls a service.

## Limits

- **Server components in `rsc` mode.** Farm doesn't run plugins there yet, so the widget never starts by itself and `verifyBot` throws a `BotError` that says so. `islands` mode works.
- **Cloudflare Pages.** Farm's default compatibility date exposes no bindings at runtime, so secrets aren't found and every check fails with a `BotError`. Use compatibility date `2025-04-01` or later, or the `cloudflare-module` preset, or pass `secretKey`.
- **reCAPTCHA** means the v2 checkbox. v3 has no widget, so it needs its own provider.
- **One checker per app.** The plugin can be added once, so two forms can't use two different checkers.
- **A checker can't add routes.** One that issues challenges from the server needs a route in the app for it.
- **A checker with no browser half has no `<BotCheck>`.** Leave the component out, or nothing tells the page it passed.
- **The hostname check** relies on the provider's report, which test keys don't give. By default it compares against the request's host, which a client can set on a server it reaches directly. Set `hostnames` for a Node server without a proxy that fixes the host, or behind one that rewrites it. Each provider's own domain allowlist still applies.
