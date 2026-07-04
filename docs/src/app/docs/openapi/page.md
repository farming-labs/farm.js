---
title: "OpenAPI Reference"
description: "Generate and publish API reference docs from Farm API route metadata, with Scalar-style presentation."
section: "Content"
---

# OpenAPI Reference

Generate and publish API reference docs from Farm API route metadata, with Scalar-style presentation.

## Enable OpenAPI

**farm.config.ts**

```ts
export default defineFarmConfig({
  openapi: {
    enabled: true,
    route: "/docs/reference",
    title: "Farm API",
    version: "1.0.0",
  },
});
```

## Reference route

The OpenAPI route can be included in generated route types so docs navigation and Link hrefs stay aware of the reference page.
