// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { getFarmClientDataCache } from "../client-cache";
import { createRendererQuery } from "../renderer-client";
import type { ServerQuery } from "../server-query";
import {
  createServerQueryCallKey,
  fetchServerQuery,
  prefetchServerQuery,
} from "../server-query-runtime";

// The browser query cache is one module-level store. On the server it would be
// shared by every request in the process, so server reads must never use it.
let visitor = "alice";
let reads = 0;
const accountQuery = (async () => {
  reads += 1;
  return { email: `${visitor}@example.com` };
}) as ServerQuery<void, { email: string }>;

afterEach(() => {
  visitor = "alice";
  reads = 0;
  getFarmClientDataCache().clear();
});

it("runs server reads for each caller instead of sharing a cached result", async () => {
  await expect(fetchServerQuery(accountQuery, undefined, { staleTime: 60_000 })).resolves.toEqual({
    email: "alice@example.com",
  });
  await prefetchServerQuery(accountQuery, undefined, { staleTime: 60_000 });

  visitor = "bob";
  await expect(fetchServerQuery(accountQuery, undefined, { staleTime: 60_000 })).resolves.toEqual({
    email: "bob@example.com",
  });
  expect(reads).toBe(3);
  expect(getFarmClientDataCache().get(createServerQueryCallKey(accountQuery, undefined))).toBe(
    undefined,
  );
});

it("gives renderer queries an idle server snapshot that starts no read", async () => {
  // A browser read left in the cache must not reach a server render either.
  getFarmClientDataCache().set(createServerQueryCallKey(accountQuery, undefined), {
    data: { email: "alice@example.com" },
    updatedAt: Date.now(),
    staleAt: Number.POSITIVE_INFINITY,
    status: "success",
    error: null,
    fetching: false,
  });

  const observer = createRendererQuery(accountQuery, undefined);
  const unsubscribe = observer.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(observer.getSnapshot()).toEqual({
    data: undefined,
    error: null,
    status: "idle",
    pending: false,
    fetching: false,
    stale: true,
  });
  expect(reads).toBe(0);
  visitor = "bob";
  await expect(observer.refetch()).resolves.toEqual({ email: "bob@example.com" });
  unsubscribe();
  observer.dispose();
});
