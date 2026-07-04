---
title: "Query and Params"
description: "Parse search params and route params with typed helpers on the server and synchronized state on the client."
section: "Data and APIs"
---

# Query and Params

Parse search params and route params with typed helpers on the server and synchronized state on the client.

## Server parsing

**src/app/search/page.tsx**

```tsx
import type { PagePropsSafe } from "@farmjs/core/query";
import { asInteger, asString, loadSearchParams } from "@farmjs/core/query/server";

export default async function SearchPage({ searchParams }: PagePropsSafe) {
  const query = await loadSearchParams(searchParams, {
    q: asString.withDefault!(""),
    page: asInteger.withDefault!(1),
  });

  return <pre>{JSON.stringify(query, null, 2)}</pre>;
}
```

## Client query state

**src/components/search-controls.tsx**

```tsx
"use client";

import { asString, useQueryState } from "@farmjs/core/query/client";

export function SearchControls() {
  const [q, setQ] = useQueryState("q", asString.withDefault!(""));
  return <input value={q} onChange={(event) => setQ(event.target.value)} />;
}
```
