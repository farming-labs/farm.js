# @farm.js/strapi

Strapi 5 CMS integration for Farm.js applications. It configures the official Strapi client,
unwraps typed collection reads, builds responsive image props from generated upload variants, and
receives authenticated webhooks so cached content can be refreshed after an editor publishes.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/strapi @strapi/client
```

`@strapi/client` is a peer dependency so the application and integration use one client version.

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { strapi } from "@farm.js/strapi";

export default defineConfig({
  integrations: {
    cms: strapi(),
  },
});
```

With no options, values come from the environment:

| Variable                | Purpose                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `STRAPI_API_URL`        | Strapi Content API base URL, including `/api`.                  |
| `STRAPI_MEDIA_URL`      | Optional public media origin. Defaults to the API URL's origin. |
| `STRAPI_API_TOKEN`      | Optional server-only API token for non-public content.          |
| `STRAPI_WEBHOOK_SECRET` | Required once webhook invalidation is configured.               |

A missing API URL fails while configuration loads instead of on the first content request.

## Read content

Build the client once and reuse it in the integration and application server code.

```ts
// src/lib/cms.server.ts
import {
  createStrapiClient,
  createStrapiCollection,
  resolveStrapiConfig,
  type StrapiDocument,
} from "@farm.js/strapi";

interface Article extends StrapiDocument {
  title: string;
  slug: string;
}

export const cms = createStrapiClient(resolveStrapiConfig({}));
export const articles = createStrapiCollection<Article>(cms, "articles");
```

```ts
// farm.config.ts
integrations: {
  cms: strapi({ instance: cms }),
}
```

Wrap collection reads in `createServerQuery` to validate and cache the result. The helper accepts
the official client's `populate`, `fields`, `filters`, `sort`, `pagination`, `locale`, and `status`
query options and unwraps the REST `data` envelope.

```ts
import { createServerQuery } from "@farm.js/core";
import { articles } from "./cms.server";

export const postsQuery = createServerQuery({
  key: () => ["strapi", "articles"],
  staleTime: "5m",
  handler: () =>
    articles.find({
      fields: ["title", "slug"],
      populate: ["cover"],
      sort: ["publishedAt:desc"],
      status: "published",
    }),
});
```

The generic describes the fields your application expects. Keep runtime validation on the server
query boundary because Strapi's returned fields still depend on permissions and `populate`.

## Invalidate on publish

Strapi can send a fixed header with every webhook. Farm verifies that shared secret before parsing
the body and asks the application which cache entries the event affects.

```ts
strapi({
  instance: cms,
  webhook: {
    onChange(payload) {
      if (payload.model !== "article") return;
      const entry = payload.entry as { documentId?: string; slug?: string };
      return {
        keys: [
          ["strapi", "articles"],
          ...(entry.documentId ? [["strapi", "article", entry.documentId] as const] : []),
        ],
        paths: ["/articles", ...(entry.slug ? [`/articles/${entry.slug}`] : [])],
      };
    },
  },
});
```

In Strapi, create a webhook under **Settings > Webhooks**:

- URL: `https://your-app.example/api/strapi/webhook`
- Events: the entry and media events your mapping handles
- Header name: `x-farm-webhook-secret`
- Header value: the value of `STRAPI_WEBHOOK_SECRET`

You can change both `webhook.path` and `webhook.secretHeader`. Strapi does not sign or retry webhook
deliveries, so use `staleTime` as the freshness fallback rather than relying on the webhook alone.

## Serve images

`getStrapiImageProps` selects the smallest generated variant at least as wide as requested and
builds a `srcset` from the real variants on that asset. It never invents a transformation URL.

```tsx
import { getStrapiImageProps, type StrapiMediaAsset } from "@farm.js/strapi";

export function Cover({ asset }: { asset: StrapiMediaAsset }) {
  return (
    <img
      {...getStrapiImageProps(asset, {
        mediaUrl: process.env.STRAPI_MEDIA_URL ?? process.env.STRAPI_API_URL,
        width: 800,
        sizes: "100vw",
      })}
    />
  );
}
```

Absolute upload-provider URLs are preserved. Relative URLs are resolved against `mediaUrl`, which
can differ from the Content API host.

## Production notes

- Keep `STRAPI_API_TOKEN` and the official client in server-only modules. Do not import them from a
  browser entry.
- Farm's default data cache is in memory per process. Configure a distributed cache adapter when a
  webhook must invalidate every server instance.
- Strapi 5's draft status requires an API token that can read the content type. Do not make draft
  selection depend on an untrusted query parameter; gate it behind application-owned preview auth.

## Options

| Option                 | Default                 | Notes                                              |
| ---------------------- | ----------------------- | -------------------------------------------------- |
| `apiUrl`               | `STRAPI_API_URL`        | Content API base URL, including `/api`.            |
| `mediaUrl`             | API origin              | Public origin for relative upload URLs.            |
| `token`                | `STRAPI_API_TOKEN`      | Server only.                                       |
| `instance`             |                         | Existing `StrapiClient`; skips API URL validation. |
| `webhook.secret`       | `STRAPI_WEBHOOK_SECRET` |                                                    |
| `webhook.path`         | `/api/strapi/webhook`   |                                                    |
| `webhook.secretHeader` | `x-farm-webhook-secret` | Configure the same custom header in Strapi.        |
| `webhook.onChange`     |                         | Maps a payload to `{ keys?, paths? }`.             |
| `log`                  |                         | Integration lifecycle logger.                      |
