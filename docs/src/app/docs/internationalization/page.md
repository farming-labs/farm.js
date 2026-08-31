---
title: "Internationalization"
description: "Build localized Farm apps with typed ICU messages, locale-aware routing, request detection, formatting, caching, and RTL from one config."
section: "Core"
---

# Internationalization

Farm internationalization connects locale configuration to routing, rendering, navigation, APIs, middleware, caching, and deployment. It does not require a provider, a second config file, or a locale segment in the app directory.

## Quick start

Configure the supported locales in `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  i18n: {
    locales: ["en", "fr", "ar"],
    defaultLocale: "en",
    fallbackLocale: "en",
    routing: "prefix-except-default",
    strict: true,
  },
});
```

Create one nested JSON catalog per locale.

**src/messages/en.json**

```json
{
  "home": {
    "title": "Build for every market",
    "welcome": "Welcome, {name}!"
  },
  "cart": {
    "items": "{count, plural, =0 {Your cart is empty} one {# item} other {# items}}"
  }
}
```

**src/messages/fr.json**

```json
{
  "home": {
    "title": "Construisez pour chaque marche",
    "welcome": "Bienvenue, {name} !"
  },
  "cart": {
    "items": "{count, plural, =0 {Votre panier est vide} one {# article} other {# articles}}"
  }
}
```

Farm flattens nested objects into keys such as `home.title` and `cart.items`. During development, builds, and `farm generate`, it writes the catalog declarations into the consolidated `src/farm.d.ts` file.

## Translate on the server

Use the server entry from pages, layouts, API routes, server functions, middleware handlers, and other server-only code that runs inside a request:

```tsx
import { format, getLocale, getLocaleSource, t } from "@farm.js/core/i18n/server";

export default function HomePage() {
  return (
    <main>
      <h1>{t("home.title")}</h1>
      <p>{t("home.welcome", { name: "Kinfe" })}</p>
      <p>{t("cart.items", { count: 3 })}</p>
      <p>{format.number(128_400)}</p>
      <small>
        {getLocale()} from {getLocaleSource()}
      </small>
    </main>
  );
}
```

`getLocale()` returns the locale for the current request. `getLocaleSource()` returns `url`, `cookie`, `accept-language`, `default`, or `explicit`, which is useful for diagnostics and APIs.

Request-bound functions throw outside a request context. For background work or code that must translate a known locale, create a translator explicitly:

```ts
import { createTranslator, runWithLocale } from "@farm.js/core/i18n/server";

const t = createTranslator("fr");
const subject = t("home.welcome", { name: "Amina" });

await runWithLocale("fr", async () => {
  await renderLocalizedInvoice();
});
```

## Translate in client components

Use the client entry in components with hooks or browser interaction:

```tsx
"use client";

import { useLocale, useTranslations } from "@farm.js/core/i18n/client";

export function LocaleMenu() {
  const { locale, locales, direction, setLocale } = useLocale();
  const t = useTranslations();

  return (
    <div dir={direction}>
      <p>{t("home.welcome", { name: "Kinfe" })}</p>
      {locales.map((option) => (
        <button
          aria-pressed={option === locale}
          key={option}
          onClick={() => setLocale(option)}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}
```

`setLocale()` writes the configured locale cookie and performs a document navigation to the matching locale URL. The navigation reloads the server-rendered page and its catalog together, so the browser never mixes messages from two locales.

Imperative client APIs are also available:

```ts
import { format, getLocale, setLocale, t } from "@farm.js/core/i18n/client";

const locale = getLocale();
const total = format.currency(49, "USD");
const title = t("home.title");
```

## Locale routes

The same app route serves every locale. A file such as `src/app/products/page.tsx` remains `/products` internally; Farm resolves the public locale URL before matching it.

| `routing` value         | English default | French         | Use when                                                             |
| ----------------------- | --------------- | -------------- | -------------------------------------------------------------------- |
| `prefix-except-default` | `/products`     | `/fr/products` | The default locale should keep clean URLs. This is the default.      |
| `prefix-always`         | `/en/products`  | `/fr/products` | Every locale needs an explicit, symmetric URL.                       |
| `none`                  | `/products`     | `/products`    | Locale comes only from request signals and URLs must stay unchanged. |

Farm canonicalizes locale paths. With `prefix-except-default`, a request for `/en/products` redirects to `/products`.

`Link` preserves the active locale automatically:

```tsx
import { Link } from "@farm.js/core/client";

export function ProductLinks() {
  return (
    <nav>
      <Link href="/products">Products in the current locale</Link>
      <Link href="/products" locale="fr">
        Produits
      </Link>
    </nav>
  );
}
```

Farm also strips the locale before route and middleware matching, keeps it in SPA page-data snapshots, and localizes internal `redirect()` destinations. Existing page, layout, loading, error, metadata image, and middleware files do not need locale wrappers.

Configuration `redirects()`, `rewrites()`, and `headers()` use the same internal, unprefixed source
paths. A request such as `/fr/legacy` can match a `/legacy` rule; an internal redirect or rewrite
destination keeps the active `fr` prefix. Development and production apply this behavior equally.

## Request signals

For a request without an explicit locale prefix, Farm resolves the locale in this order:

1. An explicit locale URL, when routing uses prefixes.
2. The configured locale cookie.
3. Weighted `Accept-Language` values sent by the browser.
4. `defaultLocale`.

Regional values match a supported base language, so `fr-CA` can resolve to `fr`. Explicit URLs always win because they are canonical, shareable, and safe to cache.
`Accept-Language` quality values must be between 0 and 1 with at most three decimal places. Farm
honors `q=0` exclusions when expanding a positive `*` wildcard; an invalid quality is treated as
unacceptable rather than outranking a valid language.

Change the fallback signals with `detection`:

```ts
i18n: {
  locales: ["en", "fr"],
  defaultLocale: "en",
  detection: ["url", "cookie"],
}
```

Set `detection: false` to ignore locale cookies and `Accept-Language`; explicit locale URLs still select their locale.

Signal-driven responses include `Vary: Cookie, Accept-Language` for the enabled signals and use `Cache-Control: private, no-store`. Explicit locale URLs remain independently cacheable. This prevents a proxy from serving one visitor's language to another.

## API routes and middleware

API paths are not redirected to locale-prefixed URLs. Read the request locale from the same server context:

**src/app/api/summary/route.ts**

```ts
import { getLocale, getLocaleSource, t } from "@farm.js/core/i18n/server";

export function GET() {
  return Response.json({
    locale: getLocale(),
    source: getLocaleSource(),
    summary: t("cart.items", { count: 3 }),
  });
}
```

The normal `/api/summary` endpoint can resolve its locale from the cookie or `Accept-Language`. This keeps API contracts stable while still allowing localized responses.

Middleware matchers use the application pathname. Middleware registered for `/account/**` therefore runs for both `/account/**` and `/fr/account/**`. The request URL remains unchanged inside middleware when code needs the public locale path.

## ICU messages

Farm uses ICU message syntax for variables, plurals, selects, dates, numbers, and rich tags:

```json
{
  "profile": {
    "hello": "Hello, {name}!",
    "role": "{role, select, admin {Administrator} member {Member} other {Guest}}",
    "inbox": "{count, plural, =0 {No messages} one {# message} other {# messages}}",
    "updated": "Updated {date, date, medium}",
    "guide": "Read the <strong>{name}</strong> guide"
  }
}
```

Rich messages use `t.rich()` and provide a function for each tag:

```tsx
const content = t.rich("profile.guide", {
  name: "routing",
  strong: (chunks) => <strong>{chunks}</strong>,
});
```

Use the translator helpers when a component needs lower-level access:

```ts
t.has("profile.guide");
t.raw("profile.guide");
```

`t()` returns text and rejects rich output. `t.rich()` preserves React-compatible values, `t.raw()` returns the source ICU message, and `t.has()` checks the current locale plus its fallback catalog.

## Locale formatting

The server and client entries expose the same formatting surface:

```ts
format.number(128_400);
format.currency(49, "USD");
format.date(new Date(), { dateStyle: "long" });
format.relativeTime(-2, "day");
format.list(["Auth", "Billing", "Email"]);
```

Each helper uses the active locale and the platform `Intl` implementation. Pass normal `Intl` options when the product needs a specific style, currency display, time zone, or unit.

## Generated types and validation

The generated i18n section in `src/farm.d.ts` augments `@farm.js/core/i18n` with exact locale names, message keys, and ICU variables:

```ts
t("home.title"); // valid
t("cart.items", { count: 3 }); // valid
t("cart.items", { name: "Kinfe" }); // type error
t("missing.key"); // type error
setLocale("de"); // type error when de is not configured
```

The default locale is the type and validation reference. Farm reports invalid JSON or ICU syntax during startup and builds. With `strict: true`, every locale must contain the same keys and each translated message must use the same variable names and kinds.

Production mode enables strict validation by default. Set it explicitly in shared config so development, CI, and production enforce the same catalog contract.

## Caching and rendering

Farm includes the active locale in `unstable_cache()` keys automatically:

```ts
import { unstable_cache } from "@farm.js/core/cache";
import { getLocale } from "@farm.js/core/i18n/server";

const getNavigation = unstable_cache(async () => loadNavigation(getLocale()), ["navigation"], {
  revalidate: 300,
});
```

The English and French results occupy different cache entries even though the application key is the same.

Static routes with URL prefixes expand once per locale. `routing: "none"` keeps localized pages dynamic because one static URL cannot safely contain multiple languages. PPR shell keys also include the locale.

## Document language, direction, and SEO

Farm sets these values during server rendering:

- `<html lang>` from the resolved locale.
- `<html dir>` from the locale direction.
- `hreflang` links for every configured locale plus `x-default` when URLs use prefixes.
- Locale-aware Open Graph and Twitter image URLs.
- A serialized locale snapshot for hydration.

Common right-to-left languages such as Arabic, Persian, Hebrew, and Urdu resolve to `rtl` automatically. Override a locale when the application needs a custom direction:

```ts
i18n: {
  locales: ["en", "ar"],
  defaultLocale: "en",
  direction: {
    ar: "rtl",
  },
}
```

Use logical CSS properties such as `margin-inline-start`, `padding-inline`, and `border-inline-end` so layouts adapt to both directions.

## Full configuration

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  i18n: {
    locales: ["en", "fr", "ar"],
    defaultLocale: "en",
    fallbackLocale: "en",
    messages: "src/messages",
    routing: "prefix-except-default",
    detection: ["url", "cookie", "accept-language"],
    strict: true,
    cookie: {
      name: "farm_locale",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
      secure: true,
    },
    direction: {
      ar: "rtl",
    },
  },
});
```

| Option           | Default                 | Purpose                                                                 |
| ---------------- | ----------------------- | ----------------------------------------------------------------------- |
| `locales`        | Required                | Supported BCP 47 locale names.                                          |
| `defaultLocale`  | Required                | Locale used when no request signal matches.                             |
| `fallbackLocale` | `defaultLocale`         | Catalog used when a non-strict locale is missing a key.                 |
| `messages`       | `src/messages`          | Directory containing `<locale>.json`, or a path containing `{locale}`.  |
| `routing`        | `prefix-except-default` | Public locale URL strategy.                                             |
| `detection`      | URL, cookie, browser    | Enabled request signals. `false` disables cookie and browser detection. |
| `strict`         | `true` in production    | Require matching keys and ICU variable signatures.                      |
| `cookie`         | `farm_locale`, one year | Name, lifetime, path, SameSite, and Secure behavior.                    |
| `direction`      | Inferred                | Per-locale `ltr` or `rtl` overrides.                                    |

For a custom catalog layout, include `{locale}` in the path:

```ts
i18n: {
  locales: ["en", "fr"],
  defaultLocale: "en",
  messages: "content/locales/{locale}/app.json",
}
```

## Production checklist

1. Keep `strict: true` and run the application type check in CI.
2. Use canonical locale names such as `en-US` and `pt-BR`.
3. Confirm every locale URL renders the expected `lang`, `dir`, and `hreflang` values.
4. Verify browser and cookie detection without caching the redirect response publicly.
5. Use logical CSS properties and test at least one RTL locale when supported.
6. Send the user's locale with background jobs, emails, and webhooks, then use `createTranslator(locale)` or `runWithLocale(locale, fn)`.

The runnable implementation is in `examples/i18n`.
