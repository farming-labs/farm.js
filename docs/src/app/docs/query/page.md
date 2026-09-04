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
import type { PagePropsSafe } from "@farm.js/core/query";
import { asInteger, asString, loadSearchParams } from "@farm.js/core/query/server";

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

import { asString, useQueryState } from "@farm.js/core/query/client";

export function SearchControls() {
  const [q, setQ] = useQueryState("q", asString.withDefault!(""), {
    throttleMs: 150,
  });
  return <input value={q} onChange={(event) => setQ(event.target.value)} />;
}
```

`throttleMs` coalesces rapid writes to the same query key. Updates to different keys are
composed against the latest URL, and returning a value to the current URL cancels its queued write.
If a component changes the key or parser it passes to the hook, the returned value is immediately
re-read from the current URL.

## Multiple query values

Use `useQueryStates` when several controls should update together. This keeps the browser URL as the source of shareable state for filters, pagination, and tabs.
Changing the parser map replaces the returned object with exactly the newly declared keys.

**src/components/product-filters.tsx**

```tsx
"use client";

import { asInteger, asString, useQueryStates } from "@farm.js/core/query/client";

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
import type { PageProps } from "@farm.js/core";
import { asString, loadRouteParams } from "@farm.js/core/query/server";

export default async function UserPage({ params }: PageProps) {
  const { id } = await loadRouteParams(params, {
    id: asString,
  });

  return <main>User {id}</main>;
}
```

## Pagination metadata

`createPaginationMeta(searchParams, { totalItems, itemsPerPage })` returns a safe page, offset,
limit, and next/previous flags for server-rendered lists. Missing, malformed, zero, negative, or
unsafe `page` values fall back to page 1. `totalItems` must be a non-negative safe integer and
`itemsPerPage` must be a positive safe integer; invalid configuration throws a `RangeError`.

## Parser reference

| Parser              | Reads                                                     |
| ------------------- | --------------------------------------------------------- |
| `asString`          | Plain strings.                                            |
| `asInteger`         | Complete, safe integer values for pagination and limits.  |
| `asFloat`           | Complete finite decimal or exponent values.               |
| `asBoolean`         | Boolean flags.                                            |
| `asArrayOf(parser)` | Repeated values serialized through another parser.        |
| `asJson`            | Structured JSON encoded in the URL.                       |
| `asIsoDate`         | Calendar-valid `YYYY-MM-DD` values.                       |
| `asIsoDateTime`     | Calendar-valid ISO date-times with `Z` or numeric offset. |

`asArrayOf` keeps the readable comma-separated format for simple values. When an item contains a
comma or would otherwise be ambiguous, Farm switches to a structured representation automatically
so parsing the generated URL returns the original items.

## Production notes

- Parse query on the server before passing values to database queries.
- Use defaults for values that should always be present in UI state.
- Use `replaceState` for filters that change often, and `pushState` when each change should be browser-history navigable.
- Keep large state out of the URL; store only the values users should be able to share.
