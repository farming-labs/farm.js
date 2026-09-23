---
title: "Sanity Integration"
description: "Read content from Sanity with typed server queries, serve images from the Sanity CDN, and invalidate cached pages the moment an editor publishes."
section: "Integrations"
---

# Sanity Integration

Read content from Sanity with typed server queries, serve images from the Sanity CDN, and invalidate cached pages the moment an editor publishes.

## Configure Sanity

```bash
pnpm add @farm.js/sanity @sanity/client
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { sanity } from "@farm.js/sanity";

export default defineConfig({
  integrations: {
    cms: sanity(),
  },
});
```

With no options, the integration reads its configuration from the environment.

| Variable                | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `SANITY_PROJECT_ID`     | Project id. `SANITY_STUDIO_PROJECT_ID` is also read.                           |
| `SANITY_DATASET`        | Dataset. `SANITY_STUDIO_DATASET` is also read.                                 |
| `SANITY_API_VERSION`    | Optional. `SANITY_STUDIO_API_VERSION` is also read. Defaults to a pinned date. |
| `SANITY_API_READ_TOKEN` | Optional. A Viewer token, needed for private datasets and for drafts.          |
| `SANITY_WEBHOOK_SECRET` | Required once a webhook is configured.                                         |

A missing project id or dataset fails when the config loads, with a message naming the variables.

A dataset that requires a token answers an unauthenticated query with an empty result rather than
an error. When content is missing, check the token first.

## Choose client ownership

The application owns the Sanity client. Build it once, use it directly in queries, and pass the
same object to the integration so Farm does not construct a second one.

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

`createSanityClient` maps the resolved configuration onto `@sanity/client` field by field. Pass any
configured `SanityClient` through `instance` for options the integration does not expose.

## Read content

Wrap GROQ queries in `createServerQuery`. Results are cached under the query key and can be
invalidated by that key later.

```ts
// src/lib/posts.ts
import { createServerQuery } from "@farm.js/core";
import { z } from "zod";
import { cms } from "./cms.server";

const post = z.object({ title: z.string(), slug: z.string(), authorName: z.string().nullable() });

export const postsQuery = createServerQuery({
  output: z.array(post),
  key: () => ["sanity", "post", "list"],
  staleTime: "5m",
  handler: () =>
    cms.fetch(`*[_type == "post"] | order(publishedAt desc) {
      title, "slug": slug.current, "authorName": author->name
    }`),
});
```

```tsx
// src/app/posts/page.tsx
import { postsQuery } from "../../lib/posts";

export default async function PostsPage() {
  const posts = await postsQuery();
  return (
    <ul>
      {posts.map((post) => (
        <li key={post.slug}>{post.title}</li>
      ))}
    </ul>
  );
}
```

## Serve images

`createSanityImageLoader` returns a loader for Farm's `Image` component that resolves images on the
Sanity CDN, negotiates the format from the request, and never upscales.

```tsx
import { Image } from "@farm.js/core/image";
import { createSanityImageLoader } from "@farm.js/sanity";

const sanityImage = createSanityImageLoader({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET!,
});

<Image loader={sanityImage} src={post.coverAssetId} width={800} height={450} alt={post.title} />;
```

`src` is the asset id, for example `image-abc-2000x3000-jpg`. Crop and hotspot live on the image
object and cannot travel through a string, so for art-directed images build the base URL with
`@sanity/image-url` and pass that URL as `src`. The loader appends the responsive parameters to it.

## Invalidate on publish

Sanity can call the application when a document changes. The integration verifies that the request
came from Sanity, then asks the application which cached entries the change affects.

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

`keys` are server query keys. `paths` are route paths whose rendered output is revalidated as well.
Return nothing for changes that affect no cached content.

In Sanity, create the webhook under **API > Webhooks**:

- URL: `https://your-app.example/api/sanity/webhook`
- Trigger on create, update and delete
- Filter: `_type in ["post", "author"]`, or whichever types `onChange` maps
- Projection: `{ _id, _type, "slug": slug.current }`
- Secret: the value of `SANITY_WEBHOOK_SECRET`

The payload handed to `onChange` is whatever the projection returns. A document referenced by others
can list them, for example `"slugs": *[_type == "post" && references(^._id)].slug.current`.

The route answers `401` for a bad signature and `400` for a malformed body, neither of which Sanity
retries, and `500` when `onChange` throws, which it does retry.

## Production notes

**Read through the API, not the CDN.** Set `useCdn: false` when the webhook drives invalidation. The
webhook fires before Sanity's CDN has updated, so a refetch through the CDN can return the previous
content and cache it again for the full `staleTime`. Farm's cache is the cache in this setup.

**Multiple instances.** Farm's data cache lives in memory per process unless a distributed adapter is
configured. On a serverless platform the webhook reaches one instance and clears only that
instance's memory. Configure an adapter such as `@farm.js/cache-redis` so invalidation reaches every
instance.

**Tokens.** `SANITY_API_READ_TOKEN` should be a Viewer token. It is read on the server only and is
never passed to the browser.

## Options

| Option             | Default               | Notes                                                 |
| ------------------ | --------------------- | ----------------------------------------------------- |
| `projectId`        | env                   |                                                       |
| `dataset`          | env                   |                                                       |
| `apiVersion`       | pinned date           | Exported as `DEFAULT_SANITY_API_VERSION`.             |
| `token`            | env                   | Server only.                                          |
| `useCdn`           | `true`                | Set `false` with webhook invalidation.                |
| `instance`         |                       | Existing `SanityClient`. Skips credential validation. |
| `webhook.secret`   | env                   |                                                       |
| `webhook.path`     | `/api/sanity/webhook` |                                                       |
| `webhook.onChange` |                       | Maps a payload to `{ keys?, paths? }`.                |
| `log`              |                       | Integration lifecycle logger.                         |
