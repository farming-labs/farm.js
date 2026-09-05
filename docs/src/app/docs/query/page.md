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
re-read from the current URL. A queued write is cancelled when its owning hook changes keys or
unmounts, preventing an old component from modifying the URL of a later page.

Repeated keys have the same meaning during server rendering and in client hooks. For example,
`?tag=react&tag=vite` is read as both values by `asArrayOf(asString)`.

When Farm's SPA router is installed, shallow query pushes participate in its normal history index.
Back/forward blockers therefore receive the rendered query location and can restore a blocked
traversal without inserting a duplicate entry.

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

`asArrayOf` keeps its existing comma-separated format by default. When items can contain commas,
opt in to the structured format so generated URLs round-trip those values:

```ts
const locations = asArrayOf(asString, { format: "structured" });
```

The item parser still decides how each value is normalized. `asString` trims surrounding whitespace
and treats an empty string as missing. Use an exact string parser when those values are significant:

```ts
import { asArrayOf, createParser } from "@farm.js/core/query";

const exactString = createParser<string>({
  parse: (value) => value,
  serialize: (value) => value,
});
const labels = asArrayOf(exactString, { format: "structured" });
```

The structured parser still accepts ordinary comma URLs during migration and emits a versioned
`~farm-array:v1:` representation only when the comma format would lose information. Because the
default parser never reserves that namespace, existing literal values such as
`~farm-array:v1:["legacy"]` retain their comma-format meaning.

## Production notes

- Parse query on the server before passing values to database queries.
- Use defaults for values that should always be present in UI state.
- Use `replaceState` for filters that change often, and `pushState` when each change should be browser-history navigable.
- Keep large state out of the URL; store only the values users should be able to share.
