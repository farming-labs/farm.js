/** @vitest-environment jsdom */
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServerFn } from "../server-fn";
import {
  useAction,
  useServerFn,
  type UseActionReturn,
  type UseServerFnReturn,
} from "../server-fn-client";

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});
function deferred() {
  let resolve!: (value: number) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<number>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it.each([false, true])(
  "composes optimistic snapshots exactly once (StrictMode=%s)",
  async (strict) => {
    const reads = [deferred(), deferred(), deferred()];
    let next = 0;
    const handler = vi.fn(() => reads[next++].promise);
    const target = createServerFn({ handler });
    const optimistic = vi.fn(({ current }: { current: number | null }) => (current ?? 0) + 1);
    let action!: UseServerFnReturn<unknown, number>;
    function View() {
      action = useServerFn(target, { initialResult: 0, optimistic });
      return null;
    }
    await act(async () =>
      root.render(
        strict ? createElement(StrictMode, null, createElement(View)) : createElement(View),
      ),
    );
    const calls: Promise<number>[] = [];
    try {
      await act(async () => {
        for (let i = 0; i < 3; i++) calls.push(action.submit());
      });
      expect(action.result).toBe(3);
      expect(action.pending).toBe(true);
      expect(optimistic.mock.calls.map(([context]) => context.current)).toEqual([0, 1, 2]);
      expect(handler).toHaveBeenCalledTimes(3);
    } finally {
      await act(async () => {
        reads.forEach((item) => item.resolve(10));
        await Promise.all(calls);
      });
    }
  },
);

it("rolls back the latest failed action to the preceding optimistic snapshot", async () => {
  const reads = [deferred(), deferred(), deferred()];
  let next = 0;
  const target = createServerFn({ handler: () => reads[next++].promise });
  let action!: UseActionReturn<unknown, number>;
  function View() {
    action = useAction(target, {
      initialResult: 0,
      optimistic: ({ current }) => (current ?? 0) + 1,
      rollbackOnError: true,
    });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  const calls: Promise<number | Error>[] = [];
  try {
    await act(async () => {
      for (let i = 0; i < 3; i++) calls.push(action().catch((error: Error) => error));
    });
    const failure = new Error("latest failed");
    await act(async () => {
      reads[2].reject(failure);
      await calls[2];
    });
    expect(action.result).toBe(2);
    expect(action.error).toBe(failure);
    expect(action.pending).toBe(true);
  } finally {
    await act(async () => {
      reads.forEach((item) => item.resolve(10));
      await Promise.all(calls);
    });
  }
  expect(action.result).toBe(2);
  expect(action.pending).toBe(false);
});

it("uses the reset snapshot for later submissions in the same batch", async () => {
  const reads = [deferred(), deferred(), deferred()];
  let next = 0;
  const target = createServerFn({ handler: () => reads[next++].promise });
  const optimistic = vi.fn(({ current }: { current: number | null }) => (current ?? 0) + 1);
  let action!: UseServerFnReturn<unknown, number>;
  function View() {
    action = useServerFn(target, { initialResult: 0, optimistic });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  const calls: Promise<number>[] = [];
  try {
    await act(async () => {
      calls.push(action.submit());
      action.reset();
      calls.push(action.submit(), action.submit());
    });
    expect(optimistic.mock.calls.map(([context]) => context.current)).toEqual([0, 0, 1]);
    expect(action.result).toBe(2);
    await act(async () => {
      reads[0].resolve(99);
      await calls[0];
    });
    expect(action.result).toBe(2);
    expect(action.pending).toBe(true);
  } finally {
    await act(async () => {
      reads.forEach((item) => item.resolve(10));
      await Promise.all(calls);
    });
  }
});

it("does not restore an optimistic transition invalidated by reset inside the callback", async () => {
  const read = deferred();
  const target = createServerFn({ handler: () => read.promise });
  let action!: UseServerFnReturn<unknown, number>;
  function View() {
    action = useServerFn(target, {
      initialResult: 0,
      optimistic: () => {
        action.reset();
        return 99;
      },
    });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  let call!: Promise<number>;
  try {
    await act(async () => {
      call = action.submit();
    });
    expect(action).toMatchObject({ result: 0, status: "idle", pending: false });
  } finally {
    await act(async () => {
      read.resolve(42);
      await call;
    });
  }
  expect(action).toMatchObject({ result: 0, status: "idle", pending: false });
});

it("keeps newer optimistic state when the optimistic callback starts another submission", async () => {
  const reads = [deferred(), deferred()];
  let targetCalls = 0;
  const target = createServerFn({ handler: () => reads[targetCalls++].promise });
  let action!: UseServerFnReturn<unknown, number>;
  let inner: Promise<number> | undefined;
  let outer!: Promise<number>;
  let optimisticCalls = 0;
  function View() {
    action = useServerFn(target, {
      initialResult: 0,
      optimistic: () => {
        if (++optimisticCalls === 1) {
          inner = action.submit();
          return 1;
        }
        return 2;
      },
    });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  try {
    await act(async () => {
      outer = action.submit();
    });
    expect(action.result).toBe(2);
    expect(action.pending).toBe(true);
    // Inner submission dispatches first; finish the older outer request first.
    await act(async () => {
      reads[1].resolve(10);
      await outer;
    });
    expect(action.result).toBe(2);
    expect(action.pending).toBe(true);
  } finally {
    await act(async () => {
      reads.forEach((item) => item.resolve(20));
      await Promise.all([inner, outer]);
    });
  }
  expect(action.result).toBe(20);
  expect(action.pending).toBe(false);
});
