# @farm.js/sanity

Sanity CMS integration for Farm.js applications. It resolves the Sanity client configuration,
validates it at startup, and receives Sanity webhooks so cached content is invalidated the moment
an editor publishes.

Farm.js is currently in beta.

## Install

```bash
pnpm add @farm.js/sanity @sanity/client
```

`@sanity/client` is a peer dependency so the application and the integration share one client.

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { sanity } from "@farm.js/sanity";

export default defineConfig({
  integrations: {
    cms: sanity(),
  },
});
```

With no options, values come from the environment:

| Variable                | Purpose                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| `SANITY_PROJECT_ID`     | Project id. `SANITY_STUDIO_PROJECT_ID` is also read.                              |
| `SANITY_DATASET`        | Dataset. `SANITY_STUDIO_DATASET` is also read.                                    |
| `SANITY_API_VERSION`    | Optional. Defaults to a pinned date so query behaviour does not change under you. |
| `SANITY_API_READ_TOKEN` | Optional. A Viewer token, needed for private datasets and drafts.                 |
| `SANITY_WEBHOOK_SECRET` | Required once a webhook is configured.                                            |

A missing project id or dataset fails at startup rather than at the first request.

Note that a dataset which needs a token returns an empty result to an unauthenticated query,
with no error. If content is missing, check the token before anything else.

## Read content

The application owns the client. Build it once, use it directly, and hand the same object to the
integration so Farm does not construct a second one.

```ts
// src/lib/cms.server.ts
import { createSanityClient, resolveSanityConfig } from "@farm.js/sanity";

export const cms = createSanityClient(resolveSanityConfig({ useCdn: false }));
```

```ts
// farm.config.ts
integrations: {
  cms: sanity({ instance: cms }),
}
```

Wrap queries in `createServerQuery` so results are cached and can be invalidated by key.

```ts
import { createServerQuery } from "@farm.js/core";
import { cms } from "./cms.server";

export const postsQuery = createServerQuery({
  key: () => ["sanity", "post", "list"],
  staleTime: "5m",
  handler: () =>
    cms.fetch(`*[_type == "post"] | order(publishedAt desc) { title, "slug": slug.current }`),
});
```

## Invalidate on publish

Sanity can call your application when a document changes. The integration verifies the request
came from Sanity, then asks the application which cache entries the change affects.

```ts
sanity({
  instance: cms,
  webhook: {
    onChange(payload) {
      if (payload._type !== "post") return;
      const slug = payload.slug as string;
      return {
        keys: [
          ["sanity", "post", "list"],
          ["sanity", "post", slug],
        ],
        paths: ["/posts", `/posts/${slug}`],
      };
    },
  },
});
```

`keys` are server query keys. `paths` are route paths whose rendered output should be
revalidated as well. Return nothing for changes that affect no cached content.

In Sanity, create a webhook under **API > Webhooks**:

- URL: `https://your-app.example/api/sanity/webhook`
- Trigger on create, update and delete
- Projection: `{ _id, _type, "slug": slug.current }`
- Secret: the value of `SANITY_WEBHOOK_SECRET`

The payload passed to `onChange` is whatever the projection returns, so include the fields the
mapping needs. A document referenced by others can list them, for example
`"slugs": *[_type == "post" && references(^._id)].slug.current`.

Responses follow what Sanity does next: `401` for a bad signature and `400` for a malformed body
are not retried, and a `500` from a failing `onChange` is retried.

### Read through the API, not the CDN

Set `useCdn: false` on the client when the webhook drives invalidation. The webhook fires before
Sanity's CDN has updated, so a refetch through the CDN can return the previous content and cache
it again for the full `staleTime`. Farm's cache is the cache in this setup; a second one in front
of it only adds that race.

Leave the CDN on for applications that rely on `staleTime` alone, or for browser side reads.

### Multiple server instances

Farm's data cache lives in memory per process unless a distributed adapter is configured. On a
serverless platform the webhook reaches one instance and clears only that instance's memory. Use
an adapter such as `@farm.js/cache-redis` so an invalidation reaches every instance.

## Options

| Option             | Default               | Notes                                                 |
| ------------------ | --------------------- | ----------------------------------------------------- |
| `projectId`        | env                   |                                                       |
| `dataset`          | env                   |                                                       |
| `apiVersion`       | pinned date           | Exported as `DEFAULT_SANITY_API_VERSION`.             |
| `token`            | env                   | Server only. Never passed to the browser.             |
| `useCdn`           | `true`                | Set `false` with webhook invalidation.                |
| `instance`         |                       | Existing `SanityClient`. Skips credential validation. |
| `webhook.secret`   | env                   |                                                       |
| `webhook.path`     | `/api/sanity/webhook` |                                                       |
| `webhook.onChange` |                       | Maps a payload to `{ keys?, paths? }`.                |
| `log`              |                       | Integration lifecycle logger.                         |

## Bring your own client

Pass a configured client through `instance` for options the integration does not expose. The
integration uses that object as is.

```ts
import { createClient } from "@sanity/client";

sanity({ instance: createClient({ projectId, dataset, apiVersion, perspective: "published" }) });
```
