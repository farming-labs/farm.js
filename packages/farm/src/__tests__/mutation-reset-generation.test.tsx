// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useMutation, type MutationStatus } from "../mutation-client";
import { useFetcher } from "../fetcher-client";

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
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it.each([
  ["mutation", "success"],
  ["mutation", "error"],
  ["fetcher", "success"],
  ["fetcher", "error"],
])("keeps newer %s work pending after a pre-reset %s", async (kind, outcome) => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const first = deferred();
  const second = deferred();
  const target = vi
    .fn<() => Promise<string>>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const onSettled = vi.fn();
  const options = { onSuccess, onError, onSettled };
  let state!: {
    run: () => Promise<string>;
    reset: () => void;
    pending: boolean;
    status: MutationStatus;
    data: string | null;
  };
  function MutationView() {
    const mutation = useMutation(target, options);
    state = { ...mutation, run: mutation.mutateAsync };
    return null;
  }
  function FetcherView() {
    const fetcher = useFetcher(target, options);
    state = { ...fetcher, run: fetcher.submitAsync };
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(kind === "mutation" ? MutationView : FetcherView),
        ),
      ),
    );
    let older!: Promise<unknown>;
    let latest!: Promise<string>;
    await act(async () => {
      older = state.run().catch((error) => error);
    });
    await act(async () => {
      state.reset();
      latest = state.run();
    });
    expect(state.pending).toBe(true);
    const failure = new Error("old failure");
    await act(async () => {
      if (outcome === "success") first.resolve("old");
      else first.reject(failure);
      expect(await older).toBe(outcome === "success" ? "old" : failure);
    });
    expect(state).toMatchObject({ status: "pending", pending: true, data: null });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    await act(async () => {
      second.resolve("new");
      await latest;
    });
    expect(state).toMatchObject({ status: "success", pending: false, data: "new" });
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    first.resolve("cleanup");
    second.resolve("cleanup");
  }
});

it("still counts concurrent requests started after reset", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const reads = [deferred(), deferred(), deferred()];
  let next = 0;
  const target = () => reads[next++]!.promise;
  let mutation!: ReturnType<typeof useMutation<typeof target>>;
  function View() {
    mutation = useMutation(target);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(View)));
    let older!: Promise<string>;
    let first!: Promise<string>;
    let latest!: Promise<string>;
    await act(async () => {
      older = mutation.mutateAsync();
    });
    await act(async () => {
      mutation.reset();
      first = mutation.mutateAsync();
      latest = mutation.mutateAsync();
    });
    await act(async () => {
      reads[0]!.resolve("old");
      await older;
    });
    await act(async () => {
      reads[2]!.resolve("latest");
      await latest;
    });
    expect(mutation).toMatchObject({ pending: true, status: "success", data: "latest" });
    await act(async () => {
      reads[1]!.resolve("first");
      await first;
    });
    expect(mutation).toMatchObject({ pending: false, status: "success", data: "latest" });
  } finally {
    await act(async () => root.unmount());
    for (const read of reads) read.resolve("cleanup");
  }
});
