// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, type UseMutationReturn } from "../mutation-client";
import { useServerFn, type UseServerFnReturn } from "../server-fn-client";
import { invokeMutationWithRetry } from "../mutation-retry";

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

describe("invokeMutationWithRetry", () => {
  it("retries until success and reports the retry count to the delay callback", async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await invokeMutationWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error(`attempt ${calls} failed`);
        return "ok";
      },
      {
        count: 3,
        delay: (attempt) => {
          delays.push(attempt);
          return 0;
        },
      },
      () => true,
    );

    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(delays).toEqual([1, 2]);
  });

  it("throws the last error once retries are exhausted", async () => {
    let calls = 0;
    await expect(
      invokeMutationWithRetry(
        async () => {
          calls += 1;
          throw new Error(`attempt ${calls}`);
        },
        { count: 2 },
        () => true,
      ),
    ).rejects.toThrow("attempt 3");
    expect(calls).toBe(3);
  });

  it("defaults to a single attempt", async () => {
    let calls = 0;
    await expect(
      invokeMutationWithRetry(
        async () => {
          calls += 1;
          throw new Error("boom");
        },
        undefined,
        () => true,
      ),
    ).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });

  it("stops retrying when the lifecycle no longer continues", async () => {
    let calls = 0;
    await expect(
      invokeMutationWithRetry(
        async () => {
          calls += 1;
          throw new Error("boom");
        },
        { count: 5 },
        () => calls < 2,
      ),
    ).rejects.toThrow("boom");
    expect(calls).toBe(2);
  });
});

describe("useMutation server-function retry", () => {
  it("retries a failing server function through request.retry", async () => {
    let calls = 0;
    const target = async (value: string) => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return value.toUpperCase();
    };

    let mutation!: UseMutationReturn<typeof target>;
    function View() {
      mutation = useMutation(target, { request: { retry: { count: 3 } } });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    let result: string | undefined;
    await act(async () => {
      result = await mutation.mutateAsync("ok");
    });

    expect(result).toBe("OK");
    expect(calls).toBe(3);
    expect(mutation.status).toBe("success");
    expect(mutation.error).toBeNull();
  });

  it("reports the final error after retries are exhausted", async () => {
    let calls = 0;
    const target = async () => {
      calls += 1;
      throw new Error(`attempt ${calls}`);
    };

    let mutation!: UseMutationReturn<typeof target>;
    function View() {
      mutation = useMutation(target, { request: { retry: { count: 1 } } });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    await act(async () => {
      await expect(mutation.mutateAsync()).rejects.toThrow("attempt 2");
    });

    expect(calls).toBe(2);
    expect(mutation.status).toBe("error");
  });

  it("reset stops the retry loop", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const target = async () => {
        calls += 1;
        throw new Error(`attempt ${calls}`);
      };

      let mutation!: UseMutationReturn<typeof target>;
      function View() {
        mutation = useMutation(target, { request: { retry: { count: 5, delay: 1_000 } } });
        return null;
      }
      await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

      let rejected: Error | undefined;
      let settled = false;
      await act(async () => {
        mutation
          .mutateAsync()
          .catch((error: Error) => {
            rejected = error;
          })
          .finally(() => {
            settled = true;
          });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(calls).toBe(1);

      await act(async () => {
        mutation.reset();
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(settled).toBe(true);
      expect(rejected?.message).toBe("attempt 1");
      expect(calls).toBe(1);
      expect(mutation.status).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useServerFn retry", () => {
  it("retries submissions with the retry option", async () => {
    let calls = 0;
    const serverFn = (async (value: string) => {
      calls += 1;
      if (calls < 2) throw new Error("transient");
      return `saved:${value}`;
    }) as any;

    let action!: UseServerFnReturn<string, string>;
    function View() {
      action = useServerFn(serverFn, { retry: { count: 2 } });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    let result: string | undefined;
    await act(async () => {
      result = await action.submit("draft");
    });

    expect(result).toBe("saved:draft");
    expect(calls).toBe(2);
    expect(action.status).toBe("success");
  });

  it("keeps single-attempt behavior without the option", async () => {
    let calls = 0;
    const serverFn = (async () => {
      calls += 1;
      throw new Error("boom");
    }) as any;

    let action!: UseServerFnReturn<undefined, never>;
    function View() {
      action = useServerFn(serverFn);
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    await act(async () => {
      await expect(action.submit(undefined as never)).rejects.toThrow("boom");
    });

    expect(calls).toBe(1);
    expect(action.status).toBe("error");
  });
});
