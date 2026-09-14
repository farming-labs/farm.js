// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMutation, type UseMutationReturn } from "../mutation-client";

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
  "composes batched optimistic snapshots exactly once (StrictMode=%s)",
  async (strict) => {
    const pending = [deferred(), deferred(), deferred()];
    let next = 0;
    const target = vi.fn(() => pending[next++].promise);
    const optimistic = vi.fn(({ current }: { current: number | null }) => (current ?? 0) + 1);
    let mutation!: UseMutationReturn<typeof target>;
    function View() {
      mutation = useMutation(target, { initialData: 0, optimistic });
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
        for (let i = 0; i < 3; i++) calls.push(mutation.mutateAsync());
      });
      expect(mutation).toMatchObject({ data: 3, pending: true, status: "pending" });
      expect(optimistic.mock.calls.map(([context]) => context.current)).toEqual([0, 1, 2]);
      expect(target).toHaveBeenCalledTimes(3);
      await act(async () => {
        pending[2].resolve(30);
        await calls[2];
      });
      expect(mutation).toMatchObject({ data: 30, pending: true, status: "success" });
    } finally {
      await act(async () => {
        pending.forEach((item) => item.resolve(10));
        await Promise.all(calls);
      });
    }
    expect(mutation).toMatchObject({ data: 30, pending: false, status: "success" });
  },
);

it("rolls back a failed latest submission to the preceding queued optimistic snapshot", async () => {
  const pending = [deferred(), deferred(), deferred()];
  let next = 0;
  const target = () => pending[next++].promise;
  let mutation!: UseMutationReturn<typeof target>;
  function View() {
    mutation = useMutation(target, {
      initialData: 0,
      optimistic: ({ current }) => (current ?? 0) + 1,
      rollbackOnError: true,
    });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  const calls: Promise<unknown>[] = [];
  try {
    await act(async () => {
      for (let i = 0; i < 3; i++) calls.push(mutation.mutateAsync().catch((error) => error));
    });
    const failure = new Error("latest failed");
    await act(async () => {
      pending[2].reject(failure);
      await calls[2];
    });
    expect(mutation).toMatchObject({ data: 2, error: failure, status: "error", pending: true });
  } finally {
    await act(async () => {
      pending.forEach((item) => item.resolve(10));
      await Promise.all(calls);
    });
  }
  expect(mutation).toMatchObject({ data: 2, pending: false });
});

it("uses the reset snapshot for further submissions in the same batch", async () => {
  const pending = [deferred(), deferred(), deferred()];
  let next = 0;
  const target = () => pending[next++].promise;
  let mutation!: UseMutationReturn<typeof target>;
  const optimistic = vi.fn(({ current }: { current: number | null }) => (current ?? 0) + 1);
  function View() {
    mutation = useMutation(target, { initialData: 0, optimistic });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  const calls: Promise<number>[] = [];
  try {
    await act(async () => {
      calls.push(mutation.mutateAsync());
      mutation.reset();
      calls.push(mutation.mutateAsync(), mutation.mutateAsync());
    });
    expect(optimistic.mock.calls.map(([context]) => context.current)).toEqual([0, 0, 1]);
    expect(mutation.data).toBe(2);
    await act(async () => {
      pending[0].resolve(99);
      await calls[0];
    });
    expect(mutation).toMatchObject({ data: 2, pending: true });
  } finally {
    await act(async () => {
      pending.forEach((item) => item.resolve(10));
      await Promise.all(calls);
    });
  }
});
