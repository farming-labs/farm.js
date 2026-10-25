---
title: "Markdown Mirrors"
description: "Expose markdown versions of app pages so agents, crawlers, docs tools, and support workflows can read rendered content as text."
section: "Content"
---

# Markdown Mirrors

Expose markdown versions of app pages so agents, crawlers, docs tools, and support workflows can read rendered content as text.

Every app page receives a markdown representation automatically:

- `page.tsx` routes are rendered on the server and converted into markdown.
- `page.md` and `page.mdx` routes return their original source.
- A `page.md` beside `page.tsx` overrides the generated representation without replacing the
  React page.

No configuration is required. Use source-authored pages for static content such as about pages,
policies, changelogs, and content-heavy marketing pages. Keep `page.tsx` as the canonical page when
the visual route needs React, and add a sidecar only when its generated markdown needs a curated
replacement.

## Representation precedence

| Files in a route folder      | HTML page         | Markdown representation |
| ---------------------------- | ----------------- | ----------------------- |
| `page.tsx`                   | Rendered React UI | Generated from HTML     |
| `page.tsx` and `page.md`     | Rendered React UI | Exact `page.md` source  |
| `page.md` or `page.mdx` only | Rendered Markdown | Exact source            |

## Markdown app pages

**src/app/about/page.mdx**

```mdx
---
title: About Farm
description: A markdown-first static page.
---

# About Farm

<Callout>Farm can render MDX from the app router.</Callout>
```

This creates `/about` automatically. Because the route is source-authored markdown, Farm also serves the raw source at `/about.md` by default.

## Override a React page

Keep the visual page in React:

**src/app/pricing/page.tsx**

```tsx
export default function PricingPage() {
  return <PricingCalculator />;
}
```

Then add an optional agent-focused representation beside it:

**src/app/pricing/page.md**

```md
# Pricing

Farm.js is free and open source.

## Plans

- Community: free
- Cloud: contact us
```

The browser still renders `page.tsx` at `/pricing`. Requests to `/pricing.md`, or requests to
`/pricing` with `Accept: text/markdown`, receive the exact contents of `page.md`.

The source is served only for a page an anonymous visitor may open. Farm checks by requesting the
page as a new request through the same plugin `runtime.before` hooks, middleware, and integration
guards, with its own `cookies()` and `headers()` and only standard browser headers (no
cookies, `Authorization`, custom headers such as an API key, or the caller's IP address), so a page
behind sign-in has no `.md` version: `/account.md` answers `404` even for a signed-in caller, and
the page is left out of `llms-full.txt`. The check drops `X-Forwarded-For`, `X-Real-IP`,
`Forwarded`, and `Via`, and in a production build the server reports the documentation address
`192.0.2.1` as its client, so a page behind an IP allowlist has no public `.md` version either. In
development the check arrives from the dev server's loopback address.

## Configure MDX components

**farm.config.ts**

```ts
export default defineConfig({
  mdx: {
    components: "./src/markdown-components.tsx",
    markdownRoutes: true,
  },
});
```

**src/markdown-components.tsx**

```tsx
import { Callout } from "./components/callout";

export const components = {
  Callout,
};
```

Set `mdx.markdownRoutes` to `false` when source-authored pages should render as HTML only.

### Interactive components

A `"use client"` component the components module imports hydrates as an island in React apps, so
it works inside Markdown pages, including under a layout that hydrates as a whole route. The rest
of the page stays server HTML. Island props must be serializable, the same limit as other islands.

```tsx title="src/components/copy-button.tsx"
"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
```

Islands need `mdx.components` to be a module path. Components from a package that marks itself
`"use client"` render as static HTML on Markdown pages, and Farm logs which packages it left static.

## Restrict exposed pages

Automatic mirrors include all application page routes. Restrict them when an application contains
authenticated or private pages:

**farm.config.ts**

```ts
export default defineConfig({
  md: {
    expose: ["/", "/pricing", "/docs"],
    cache: 60,
  },
});
```

## Routes

| Page     | Markdown mirror |
| -------- | --------------- |
| /        | /index.md       |
| /pricing | /pricing.md     |
| /docs    | /docs.md        |

## Use cases

- AI assistants can fetch page content without parsing the full app shell.
- Pricing, docs, changelog, and policy pages become easy to cite.
- Teams can keep one source of truth: the actual rendered page.

Disable generated mirrors for every React page with `md: false`:

```ts
export default defineConfig({
  md: false,
});
```

Explicit `page.md` and `page.mdx` sources use `mdx.markdownRoutes`; set that option to `false` when
their raw routes must also be disabled.

## llms.txt

Set `agent: { llmsTxt: true }` to publish `/llms.txt`, an index that points language models at these
mirrors, and `/llms-full.txt`, which inlines them. See
[Agent readiness](/docs/configuration#agent-readiness).

## Per-route options

Routes can include a display title and cache override.
Literal entries use exact matching without compiling a regular expression. Dynamic entries such
as `/docs/[...slug]` retain pattern matching; the first matching entry supplies the route options.

```ts
export default defineConfig({
  md: {
    expose: [
      {
        route: "/pricing",
        title: "Pricing",
        cache: 300,
      },
      "/docs/[...slug]",
    ],
    includeMetadata: true,
  },
});
```

## What gets returned

Markdown mirrors call the rendered page, strip scripts/styles and elements hidden by an attribute (`aria-hidden="true"`, or `hidden` except `hidden="until-found"`, which the browser can reveal), convert HTML headings, paragraphs, lists (ordered lists keep their numbers), blockquotes, tables (as GFM tables), and code blocks (keeping a `language-*` class or `data-language` as the fence language) into markdown, then return `text/markdown`. The mirror is built without CSS, so text hidden only by a stylesheet (`display: none`, a collapsed menu) still appears. Mark decorative text `aria-hidden` to keep it out of the mirror as well as out of screen readers.

Content without any `hidden` text (case-insensitive) skips hidden-element parsing. Any occurrence
still uses the same attribute-aware parser, including quoted values, revealable content, and forms.

When a layout row needs spaces between adjacent items, conversion assembles the row once rather
than copying it for each separator. Existing prose, letter-split words, and whitespace stay unchanged.

**Terminal**

```bash
curl http://localhost:3000/pricing.md
```

Agents can also request the normal page URL with explicit content negotiation:

```bash
curl -H "Accept: text/markdown" http://localhost:3000/pricing
```

Farm returns the same markdown representation with `Content-Type: text/markdown`,
`Content-Location: /pricing.md`, and `Vary: Accept`. The HTML response also advertises the
`.md` URL through a `Link` header and a `<link rel="alternate" type="text/markdown">` tag in the
document head, while ordinary browser requests continue to receive HTML. Set
`metadata.alternates.types["text/markdown"]` to point the head link somewhere else.

Converted mirrors preserve the page response's `Set-Cookie` headers, including on redirects, sign-in errors,
partial views, `HEAD`, and conditional `304` responses. A mirror that sets cookies uses
`Cache-Control: private, no-store`, even when `md.cache` is enabled, so a shared cache cannot replay
one reader's session cookies to another. Cookie-free mirrors keep their configured cache policy.

If the page returns a non-HTML response, such as a JSON error or a `429` rate limit, Farm returns
that response and its headers (including `Retry-After`) without dispatching the page again.
Bodyless `204`, `205`, and `304` responses also pass through, even if they declare an HTML content
type; they are not converted or filtered by partial-view parameters. Pass-through responses keep
the page's own content type and cache policy. `HEAD` keeps the status and
headers but omits the body. Sign-in redirects and non-HTML `401`/`403` responses continue to use
the Markdown explanations with the original status. Unused bodies from these explanations and
terminal `HEAD` responses are cancelled without delaying the response.

HTML `4xx` and `5xx` responses keep their original status and full converted error message.
Partial-view parameters (`outline`, `section`, `max_tokens`, `cursor`, and `actions`) do not
filter or replace errors, and a matching `If-None-Match` does not turn an error into `304`.
Converted errors preserve `WWW-Authenticate`, `Proxy-Authenticate`, `Retry-After`, and `Allow`
when present. Generated sign-in and redirect explanations also preserve these headers,
including retry guidance. HTML-specific content lengths, encodings, and ETags are not copied
onto the converted body. Successful-page views keep their normal selection and validation behavior.

The internal HTML request omits `If-Match`, `If-Unmodified-Since`, `If-None-Match`,
`If-Modified-Since`, `Range`, and `If-Range`.
An HTML cache hit or byte fragment cannot be used to construct the Markdown representation.
Farm evaluates `If-None-Match` against the selected Markdown view's own ETag after conversion;
HTML ETags do not validate the mirror. Generated mirrors have no `Last-Modified` date and ignore
`If-Modified-Since`. Byte ranges are not supported: a range request receives the complete selected
view (or `304` for a matching Markdown ETag), not a slice of HTML. This does not change ordinary
HTML requests or the page's application-level middleware checks.

Mirrors and raw Markdown sources evaluate `If-Match` before `If-None-Match`, after page and
view validation. Their ETags are weak: `If-Match: *` succeeds for an existing successful
representation, but an entity-tag (even the current weak ETag or its strong-looking form)
cannot satisfy strong comparison. A failed match returns an empty `412` response with
`Cache-Control: no-store`; it does not replace page errors, redirects, or invalid-view errors.
Use `If-None-Match` for cache revalidation. `If-Unmodified-Since` is ignored because these
Markdown representations have no modification date; the HTML page's date is not reused.

The internal page request carries the caller's abort signal. In development, disconnecting the
Markdown client also cancels the internal HTTP page fetch, including while its body is being read.
Rendering and server-side fetches that observe their request's signal can stop cooperatively;
cancellation does not undo work or side effects that have already completed. Normal response
completion does not cancel the request.

Prerendered pages, such as those exporting `dynamic = "force-static"`, are served as static files in
production, so they answer every request with HTML. They still send the `Link` header, and their
`.md` URL works, so agents should follow the header or request the `.md` URL directly.

## Read part of a page

Agents can fetch less than the whole page. Every Markdown response, from a mirror or a `page.md`,
accepts these query parameters:

```bash
curl "http://localhost:3000/pricing.md?outline"
curl "http://localhost:3000/pricing.md?section=plans"
curl "http://localhost:3000/pricing.md?max_tokens=2000"
```

- `?outline` returns the heading tree. Each entry links to its section and estimates its size in
  tokens, so an agent can decide what to read. Estimates use the same four-character approximation
  without constructing a full copy of every section.
- `?section=<id>` returns one heading and everything under it, up to the next heading at the same
  or a higher level. Ids follow GitHub's heading anchors (`## Team plans` is `team-plans`; a
  repeated heading gets `-1`, `-2`). An unknown id answers `404` with the list of valid ids.
- `?max_tokens=<n>` returns the page, or the section with `?section`, in parts of about `n` tokens
  (at least 100). Remaining-token estimates count the unread lines without copying their text.
  See [Read a long page in parts](#read-a-long-page-in-parts).

Headings inside fenced code blocks and front matter are ignored. Every Markdown response also
carries an `ETag`, so an agent can re-check a page with `If-None-Match` and receive `304 Not
Modified` when it has not changed.

### Read a long page in parts

`?max_tokens=<n>` keeps each response within an agent's budget. A page that fits comes back whole.
A longer one comes back in parts, each cut where a reader would pause, before a heading or after a
paragraph, and ending with a link to the next part:

```md
## Install

...

---

Continue: /guide.md?max_tokens=2000&cursor=48.k3j9x2a1 (about 3100 more tokens)
```

The same link is in a `Link: </guide.md?max_tokens=2000&cursor=48.k3j9x2a1>; rel="next"` header,
and the last part has neither. A part never splits a code block unless the block alone is larger
than the budget; then the part closes the block and the next one reopens it with the same language,
so every part is valid Markdown. Token counts are estimates of about four characters per token.

Continuation, restart, and outline links keep the page's own query, so
`/products.md?category=shoes&max_tokens=2000` keeps reading the shoes listing. The view parameters
(`outline`, `section`, `actions`, `max_tokens`, `cursor`) are never passed to the page itself.

The cursor names where to continue and which version of the page it belongs to. If the page changes
between requests, the next part answers `409` with a link to start again, rather than continuing
from a position that no longer lines up. A malformed cursor or a budget under 100 answers `400`.

## Describe a page's forms

The mirror turns a form's labels and buttons into text, but not what the form submits. When a page
has forms, its mirror lists one more line under `Source:`:

```md
Source: /contact

Actions: /contact.md?actions
```

`?actions` answers with the page's forms as JSON, read from the same part of the page as the mirror
and with the same hidden-element rules:

```bash
curl "http://localhost:3000/contact.md?actions"
```

```json
{
  "page": "/contact",
  "markdown": "/contact.md",
  "actions": [
    {
      "type": "form",
      "method": "POST",
      "action": "/api/contact",
      "enctype": "application/x-www-form-urlencoded",
      "fields": [{ "name": "email", "type": "email", "label": "Email", "required": true }],
      "submit": [{ "label": "Send" }]
    }
  ]
}
```

- `action` is resolved the way a browser resolves it: an empty or missing `action` submits to the
  page itself. Same-origin targets are root-relative; a form that only submits through JavaScript
  has no `action` and is marked `requiresJavaScript`.
- `fields` carry each control's name, type, label, preset value, and constraints (`required`,
  `pattern`, `min`, `max`, `minLength`, `maxLength`, `accept`). Radio buttons and checkboxes that
  share a name become one field with `options`, as do a select's options. Disabled controls are left
  out, since a browser would not submit them. Hidden fields keep their values, so a submission
  without JavaScript can be repeated; password and file inputs never include a value.
- `submit` lists the buttons, with a button's own `formaction` or `formmethod` when it has one.
- A React server action form, rendered with React's hidden `$ACTION_` fields, includes
  `serverAction.id`.
- A form that submits to an API route exposed as an MCP tool by
  [`@farm.js/mcp`](/docs/plugins/mcp) includes `tool`: the tool `name` and the MCP `endpoint` that
  serves it, so an agent can call the tool instead of posting the form. The match uses the form's
  method and resolved action against the running MCP server's tools. The caller's `authorize`
  policy still decides whether that tool is available to it.

A `page.md` source has no forms, so its `?actions` view is an empty list. The view carries an
`ETag` like every other Markdown response. Like the mirror itself, it is rendered with the caller's
request, so it shows the forms that caller would see. Farm still renders the page and extracts its
forms, but skips converting its content to Markdown when only the actions JSON is needed. Error
responses still return their full Markdown explanation. When a mirror needs both the forms and
Markdown, they share the same prepared HTML content within that request; nothing is cached across
callers.

## React Server Components apps

Apps built with `defineConfig` from `@farm.js/plugin/rsc` serve the same mirrors. Every page answers
at its `.md` URL and to `Accept: text/markdown`, with `?outline`, `?section`, `?max_tokens`, and
`?actions`. HTML pages send the `Link` header, a missing `.md` page answers a Markdown 404, and reads
fire `agent.read` events. The mirror renders the page through the normal request path, so middleware
and sign-in gates apply, and a page that must not be shared keeps its private `Cache-Control`.

The RSC renderer currently sets a deployment cookie on HTML page renders. Its generated mirrors
therefore use `private, no-store` too; setting `md.cache` does not enable shared caching while that
cookie is present. This prevents caches from replaying response cookies to another reader.

Set the same `md` options on the RSC config:

```ts title="vite.config.ts"
import { defineConfig } from "@farm.js/plugin/rsc";

export default defineConfig({
  md: { expose: ["/", "/pricing", "/docs/[...slug]"] },
});
```

`md: false` turns mirrors off. `page.md` sources are not part of the RSC pipeline yet.

RSC apps also serve `/llms.txt` by default, listing their static pages with links to these mirrors.
It is answered after middleware, like a page. Set `agent.llmsTxt` with the same options as core;
`full: true` adds `/llms-full.txt`, and `false` turns both off:

```ts title="vite.config.ts"
export default defineConfig({
  agent: { llmsTxt: { full: true, exclude: ["/admin/[...rest]"] } },
});
```

`llms.ts` and `llms-full.ts` route files are not supported in RSC apps yet.

## Production notes

- Restrict `md.expose` when authenticated or private pages should not have generated mirrors.
- Use `cache` for stable public pages.
- Add `page.md` beside `page.tsx` when the generated representation needs a precise override.
- Use `page.md` or `page.mdx` alone when markdown is the page source of truth.
- Use markdown mirrors for docs, pricing, policies, changelogs, release notes, and help center pages.
