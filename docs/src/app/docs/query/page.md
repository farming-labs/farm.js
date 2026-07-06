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

## Multiple query values

Use `useQueryStates` when several controls should update together. This keeps the browser URL as the source of shareable state for filters, pagination, and tabs.

**src/components/product-filters.tsx**

```tsx
"use client";

import { asInteger, asString, useQueryStates } from "@farmjs/core/query/client";

export function ProductFilters() {
  const [filters, setFilters] = useQueryStates(
    {
      q: asString.withDefault!(""),
      page: asInteger.withDefault!(1),
      plan: asString,
    },
    {
      history: "replaceState",
      shallow: true,
    },
  );

  return (
    <form>
      <input
        value={filters.q}
        onChange={(event) => {
          setFilters({
            q: event.target.value,
            page: 1,
          });
        }}
      />
    </form>
  );
}
```

## Route params

Use route param parsers when dynamic segments should be typed before they hit your data layer.

**src/app/users/[id]/page.tsx**

```tsx
import type { PageProps } from "@farmjs/core";
import { asString, loadRouteParams } from "@farmjs/core/query/server";

export default async function UserPage({ params }: PageProps) {
  const { id } = await loadRouteParams(params, {
    id: asString,
  });

  return <main>User {id}</main>;
}
```

## Parser reference

| Parser | Reads |
| --- | --- |
| `asString` | Plain strings. |
| `asInteger` | Integer values for pagination and limits. |
| `asFloat` | Decimal numbers. |
| `asBoolean` | Boolean flags. |
| `asArrayOf(parser)` | Repeated values serialized through another parser. |
| `asJson` | Structured JSON encoded in the URL. |
| `asIsoDate` | Date strings. |
| `asIsoDateTime` | Date-time strings. |

## Production notes

- Parse query on the server before passing values to database queries.
- Use defaults for values that should always be present in UI state.
- Use `replaceState` for filters that change often, and `pushState` when each change should be browser-history navigable.
- Keep large state out of the URL; store only the values users should be able to share.
