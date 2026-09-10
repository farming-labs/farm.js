# `@farm.js/content`

Load local Markdown, MDX, JSON, and YAML as schema-validated, typed content collections in Farm.js.

## Install

```bash
pnpm add @farm.js/content zod
```

Zod is optional. Any Standard Schema-compatible validator works, as does an object with `parse` or
`parseAsync`.

## Configure

Collections live directly in `farm.config.ts`. There is no required `content.config.ts` and no
virtual module to import from application code.

```ts
import { collection, content, files } from "@farm.js/content";
import { defineConfig } from "@farm.js/core";
import { z } from "zod";

export default defineConfig({
  plugins: [
    content({
      collections: {
        posts: collection({
          source: files("content/posts/**/*.{md,mdx}"),
          schema: z.object({
            title: z.string(),
            publishedAt: z.coerce.date(),
            tags: z.array(z.string()).default([]),
          }),
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

For a large setup, move the ordinary collection objects to any application file and import the
result into `farm.config.ts`. The filename is an application choice, not another framework config.

## Read on the server

```ts
import { getCollection, getEntry, getEntryOrThrow } from "@farm.js/content/server";

const posts = await getCollection("posts");
const optionalPost = await getEntry("posts", "guides/getting-started");
const post = await getEntryOrThrow("posts", "guides/getting-started");
```

`src/farm.d.ts` infers the collection name and final `data` type from `farm.config.ts`, including
values added by `transform`. Run `farm generate` after adding the plugin if the development server
has not generated the declaration yet.

Entry IDs are project-route friendly. They are derived from the path below the source base, with
the file extension and trailing `index` removed. For example,
`content/posts/guides/index.mdx` becomes `guides`.

## Runtime contract

- Source files are parsed and validated during Farm configuration, not on each request.
- Development watches supported content files, regenerates the private module, and reloads the page.
- Production bundles the validated collection into the server output, so source files do not need
  to exist on the deployed filesystem.
- Dates, bigints, arrays, plain objects, `undefined`, and primitive values keep their runtime types.
- Functions, symbols, class instances, circular values, invalid dates, and non-finite numbers fail
  with an actionable build error instead of silently changing shape.
- `@farm.js/content/server` is server-only. Use it in Server Components, static path generation,
  server queries, server functions, or API routes.

The plugin returns raw Markdown or MDX in `entry.body`. Rendering stays explicit so applications can
choose their renderer, component mapping, and HTML security policy.
