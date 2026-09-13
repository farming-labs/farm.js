// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { getFarmClientDataCache } from "../client-cache";
import { notifyFarmCacheInvalidation } from "../cache-invalidation";
import type { ServerQuery } from "../server-query";
import {
  beginFarmServerQueryAction,
  completeFarmServerQueryAction,
  useServerQuery,
  type UseServerQueryResult,
} from "../server-query-client";
import { createFarmServerQueryResult } from "../server-query-protocol";

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  getFarmClientDataCache().clear();
  vi.restoreAllMocks();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it.each(["refetch", "focus", "online", "invalidate", "re-enable"])(
  "stops after a failed invalidation refresh and retries on %s",
  async (trigger) => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let now = 100;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const reads: ReturnType<typeof deferred>[] = [];
    let calls = 0;
    const query = (async () => {
      const invocation = beginFarmServerQueryAction("refresh-error", []);
      calls++;
      let data = "initial";
      if (calls > 1) {
        const read = deferred();
        reads.push(read);
        data = await read.promise;
      }
      return completeFarmServerQueryAction(
        invocation,
        createFarmServerQueryResult(data, {
          key: "refresh-error",
          staleTime: 60_000,
          updatedAt: now,
        }),
      );
    }) as ServerQuery<undefined, string>;
    let result!: UseServerQueryResult<string>;
    function View({ enabled }: { enabled: boolean }) {
      result = useServerQuery(query, undefined, { enabled });
      return createElement("span", null, result.status);
    }
    const root = createRoot(document.createElement("div"));
    const render = (enabled = true) =>
      root.render(
        createElement(
          "div",
          null,
          createElement(View, { enabled }),
          createElement(View, { enabled }),
        ),
      );
    try {
      await act(async () => render());
      expect(calls).toBe(1);
      now = 200;
      await act(async () => notifyFarmCacheInvalidation("refresh-error"));
      expect(calls).toBe(2);
      const failure = new Error("service unavailable");
      await act(async () => reads[0]!.reject(failure));
      expect(calls).toBe(2);
      expect(result).toMatchObject({
        data: "initial",
        status: "error",
        error: failure,
        fetching: false,
        stale: true,
      });
      await act(async () => render());
      expect(calls).toBe(2);

      if (trigger === "re-enable") await act(async () => render(false));
      await act(async () => {
        if (trigger === "refetch") void result.refetch();
        else if (trigger === "invalidate") notifyFarmCacheInvalidation("refresh-error");
        else if (trigger === "re-enable") render(true);
        else window.dispatchEvent(new Event(trigger));
      });
      // A second invalidation in the same millisecond must still count as new work.
      expect(calls).toBe(3);
      await act(async () => reads[1]!.resolve("fresh"));
      expect(result).toMatchObject({
        data: "fresh",
        status: "success",
        fetching: false,
        stale: false,
      });
    } finally {
      await act(async () => root.unmount());
      for (const read of reads) read.resolve("cleanup");
      await Promise.resolve();
    }
  },
);
