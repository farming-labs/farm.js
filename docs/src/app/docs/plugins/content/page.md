---
title: "Content"
description: "Load local Markdown, MDX, JSON, and YAML as schema-validated, typed server content without a second config file."
section: "Plugin Ecosystem"
---

# Content

`@farm.js/content` turns local Markdown, MDX, JSON, and YAML files into typed server data. Farm
discovers the files, validates them while configuring the application, watches them in development,
and bundles the validated result into production output.

Collections are ordinary plugin options in `farm.config.ts`.

## Install

```bash
pnpm add @farm.js/content zod
```

Zod is optional. The plugin accepts Standard Schema validators, including Valibot and ArkType, or a
small custom validator with `parse` or `parseAsync`.

## Define a collection

**farm.config.ts**

```ts
import { collection, content, files } from "@farm.js/content";
import { defineConfig } from "@farm.js/core";
import { z } from "zod";

const post = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  publishedAt: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
});

export default defineConfig({
  plugins: [
    content({
      collections: {
        posts: collection({
          source: files("content/posts/**/*.{md,mdx}"),
          schema: post,
          transform: ({ data, words }) => ({
            ...data,
            readingMinutes: Math.max(1, Math.ceil(words / 220)),
          }),
        }),
      },
    }),
  ],
});
```

Adding `content()` enables the plugin. Remove it from `plugins` to disable content processing. There
is no separate `enabled` flag.

The schema validates frontmatter for Markdown and MDX. For JSON and YAML, it validates the complete
file value. `transform` runs after validation and can add or replace fields. Its output becomes the
inferred type returned to the application.

## Write content

**content/posts/hello-farm.md**

```md
---
title: Hello, Farm
description: A first typed post.
publishedAt: 2026-09-09
tags:
  - Farm.js
---

The Markdown body remains available separately from validated frontmatter.
```

Entry IDs come from the path below the common static directory of the source globs. The extension
and a trailing `index` are removed:

| Source file                                | Entry ID                 |
| ------------------------------------------ | ------------------------ |
| `content/posts/hello-farm.md`              | `hello-farm`             |
| `content/posts/guides/getting-started.mdx` | `guides/getting-started` |
| `content/posts/guides/index.md`            | `guides`                 |

Pass `files(pattern, { base: "content" })` when the ID should use an explicit base. The `ignore`
option accepts one glob or an array of globs.

## Read typed entries

Use the server entry from a Server Component, static path function, server query, server function,
or API route.

```tsx
import { getCollection } from "@farm.js/content/server";

export default async function BlogPage() {
  const posts = (await getCollection("posts"))
    .filter((entry) => !entry.data.draft)
    .sort((left, right) => right.data.publishedAt.getTime() - left.data.publishedAt.getTime());

  return (
    <ul>
      {posts.map((entry) => (
        <li key={entry.id}>
          {entry.data.title} · {entry.data.readingMinutes} min
        </li>
      ))}
    </ul>
  );
}
```

Each entry contains:

| Field      | Meaning                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| `id`       | Stable path-derived identifier used with `getEntry`.                      |
| `data`     | Validated schema output, followed by the optional transform.              |
| `body`     | Raw Markdown or MDX body. Empty for structured JSON and YAML files.       |
| `filePath` | Project-relative source path, useful for diagnostics and editorial tools. |

Read one entry when the route already has its ID:

```ts
import { getEntry, getEntryOrThrow } from "@farm.js/content/server";

const optionalPost = await getEntry("posts", "guides/getting-started");
const post = await getEntryOrThrow("posts", "guides/getting-started");
```

`getEntry` returns `undefined` for a miss. `getEntryOrThrow` includes the collection and ID in its
error, which is usually better for a path Farm already generated from the same collection.

## Generate static pages

Use a catch-all route when IDs can contain `/`.

**src/app/posts/[...slug]/page.tsx**

```tsx
import { getCollection, getEntryOrThrow } from "@farm.js/content/server";
import type { PageProps } from "@farm.js/core";

export const dynamic = "force-static";

export async function getStaticPaths() {
  return (await getCollection("posts")).map((entry) => ({
    slug: entry.id.split("/"),
  }));
}

export default async function PostPage({ params }: PageProps<"/posts/[...slug]">) {
  const post = await getEntryOrThrow("posts", params.slug);
  return <article>{post.body}</article>;
}
```

## Use a hosted CMS

`content()` is the file-backed path. For Sanity, Contentful, Storyblok, or another hosted CMS,
install the provider's SDK directly and choose where the content should enter the application:

- **Build-time snapshot:** export or sync the CMS into a generated Markdown or JSON directory before
  `farm build`, then point `files()` at that directory. The plugin validates and bundles the snapshot;
  publishing new content triggers a new deployment.
- **Live content:** keep the provider SDK in a server-only module and fetch through a
  [Server Query](/docs/server-queries). Farm can validate the response, cache published content, and
  share the typed result with server or client consumers.

For example, a Sanity-backed query can stay small:

**src/lib/cms.ts**

```ts
import { createServerQuery } from "@farm.js/core/server-query";
import { createClient } from "@sanity/client";
import { z } from "zod";

const Post = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
});

const sanity = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET!,
  apiVersion: "2026-09-09",
  useCdn: true,
});

export const cmsPosts = createServerQuery({
  output: z.array(Post),
  key: () => ["cms", "posts"],
  staleTime: "5m",
  handler: () =>
    sanity.fetch(`*[_type == "post"]{
      "id": _id,
      title,
      "slug": slug.current
    }`),
});
```

A Server Component can call `await cmsPosts()`. Point a verified CMS webhook at a Farm API route
and call `await invalidate(["cms", "posts"])` when published content changes; see
[Cache and PPR](/docs/cache-ppr). For draft previews, use a server-only read token, bypass the
provider CDN, authorize the request, and avoid a shared persistent cache. Never expose a CMS token
to a Client Component.

The same shape works with another provider: replace the client and query language, while keeping
the server-only boundary, output schema, cache key, and invalidation path. See the
[Sanity JavaScript client guide](https://www.sanity.io/docs/apis-and-sdks/js-client-getting-started)
for provider-specific setup.

## Type generation

Farm adds content inference to the same `src/farm.d.ts` used for routes and environment values. It
reads the plugin type from `farm.config.ts`, so collection keys, Zod output, coerced `Date` values,
and transform results flow into `getCollection` and `getEntry` without a handwritten registry.

Development and production builds refresh the file automatically. Run this after changing config
if an editor is open before the development server:

```bash
farm generate
```

Commit `src/farm.d.ts` when the application already commits Farm's generated declarations.

## Split a large setup

An inline config is the shortest starting point. If collections grow, extract ordinary values to a
server-owned application module rather than introducing another framework config:

**src/content.ts**

```ts
import { collection, files } from "@farm.js/content";
import { z } from "zod";

export const collections = {
  posts: collection({
    source: files("content/posts/**/*.md"),
    schema: z.object({ title: z.string() }),
  }),
};
```

**farm.config.ts**

```ts
import { content } from "@farm.js/content";
import { defineConfig } from "@farm.js/core";
import { collections } from "./src/content";

export default defineConfig({ plugins: [content({ collections })] });
```

The plugin still receives the collection through its options. The extra file is only organization
chosen by the application.

## Rendering and security

The plugin returns raw `body` text. It does not execute MDX or emit HTML automatically. This keeps
the collection renderer-neutral and lets the application choose its component mapping, Markdown
renderer, and sanitization policy. Treat author-provided HTML as untrusted unless the source is
controlled and the chosen renderer sanitizes it.

`@farm.js/content/server` fails the client build when imported into a browser environment. Use a
[Server Query](/docs/server-queries) or API route when a Client Component needs content data.

## Development and production

- Development regenerates content after supported source files are added, changed, or removed, then
  reloads the current page. Validation failures appear in Vite's error overlay with the collection,
  source file, field path, and schema message.
- Production serializes only validated values into a private `.farm/content/server.mjs` build input.
  Nitro bundles that module, so the deployed server does not read project source files per request.
- Dates and bigints keep their runtime types. Plain objects, arrays, `undefined`, and primitives are
  preserved. Functions, symbols, class instances, circular structures, invalid dates, and
  non-finite numbers fail the build instead of being silently changed.

The runnable
[`examples/content-demo`](https://github.com/farming-labs/farm.js/tree/main/examples/content-demo)
shows inline configuration, Zod coercion, computed reading time, nested IDs, static generation, and
the finished editorial UI.
