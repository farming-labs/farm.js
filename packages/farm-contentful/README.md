# @farm.js/contentful

Contentful content source for [Farm.js](https://github.com/farming-labs/farm.js). Feeds Contentful
entries into `@farm.js/content` collections, where they get the same schema validation, transforms,
and generated server types as local Markdown.

```ts
import { collection, content } from "@farm.js/content";
import { contentfulSource } from "@farm.js/contentful";

content({
  collections: {
    posts: collection({
      source: contentfulSource({
        contentType: "post",
        query: { order: ["-sys.createdAt"] },
        refreshInterval: 30_000, // dev only
      }),
      schema: post,
    }),
  },
});
```

Set `CONTENTFUL_SPACE_ID` and `CONTENTFUL_ACCESS_TOKEN`, or pass an existing client through
`client`. Entry IDs default to a string `fields.slug`, falling back to `sys.id`. Pagination past
Contentful's 1000-entry page cap is handled internally. For drafts, set
`host: "preview.contentful.com"` with `CONTENTFUL_PREVIEW_TOKEN`.

Content is a build-time snapshot: entries are fetched while the configuration loads and bundled
into production output. Point a Contentful webhook at your platform's deploy hook to rebuild on
publish. See the [content plugin docs](https://farmjs.dev/docs/plugins/content) for the shared
pipeline and the live-content alternative.
