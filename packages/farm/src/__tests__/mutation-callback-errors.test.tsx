// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMutation, type UseMutationReturn } from "../mutation-client";

let root: ReturnType<typeof createRoot>;
const report = vi.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  report.mockReset();
  vi.stubGlobal("reportError", report);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it.each([
  ["onSuccess", false, false],
  ["onSuccess", false, true],
  ["onSettled", false, false],
  ["onSettled", false, true],
  ["onError", true, false],
  ["onError", true, true],
  ["onSettled", true, false],
  ["onSettled", true, true],
] as const)(
  "isolates %s failures (target fails=%s, async callback=%s)",
  async (callback, fails, asyncCallback) => {
    let resolveOlder!: (value: string) => void;
    const older = new Promise<string>((resolve) => {
      resolveOlder = resolve;
    });
    const targetError = new Error("target failed");
    const callbackError = new Error("callback failed");
    const target = async (value: string) => {
      if (value === "older") return older;
      if (fails) throw targetError;
      return value;
    };
    const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onSettled: vi.fn() };
    callbacks[callback].mockImplementation(() => {
      if (asyncCallback) return Promise.reject(callbackError);
      throw callbackError;
    });
    let mutation!: UseMutationReturn<typeof target>;
    function View() {
      mutation = useMutation(target, {
        ...callbacks,
        initialData: "before",
        optimistic: () => "draft",
        rollbackOnError: true,
      });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));
    let first!: Promise<string>;
    try {
      await act(async () => {
        first = mutation.mutateAsync("older");
      });
      await act(async () => {
        const result = mutation.mutateAsync("latest");
        if (fails) await expect(result).rejects.toBe(targetError);
        else await expect(result).resolves.toBe("latest");
      });
      expect(mutation).toMatchObject({
        pending: true,
        status: fails ? "error" : "success",
        data: fails ? "draft" : "latest",
        error: fails ? targetError : null,
      });
      expect(callbacks.onSuccess).toHaveBeenCalledTimes(fails ? 0 : 1);
      expect(callbacks.onError).toHaveBeenCalledTimes(fails ? 1 : 0);
      expect(callbacks.onSettled).toHaveBeenCalledExactlyOnceWith(
        fails ? null : "latest",
        fails ? targetError : null,
        "latest",
      );
      expect(report).toHaveBeenCalledExactlyOnceWith(callbackError);
    } finally {
      await act(async () => {
        resolveOlder("older");
        await first;
      });
    }
    expect(mutation.pending).toBe(false);
    expect(callbacks.onSettled).toHaveBeenCalledOnce();
  },
);

it.each(["reset", "submit"] as const)(
  "does not run stale onSettled after a callback calls %s",
  async (action) => {
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const target = async (value: string) => (value === "new" ? pending : value);
    const onSettled = vi.fn();
    let mutation!: UseMutationReturn<typeof target>;
    let next: Promise<string> | undefined;
    function View() {
      mutation = useMutation(target, {
        onSuccess(value) {
          if (value !== "old") return;
          if (action === "reset") mutation.reset();
          else next = mutation.mutateAsync("new");
          throw new Error("after reentry");
        },
        onSettled,
      });
      return null;
    }
    await act(async () => root.render(createElement(View)));
    try {
      await act(async () => {
        await mutation.mutateAsync("old").catch(() => {});
      });
      expect(mutation).toMatchObject({
        status: action === "reset" ? "idle" : "pending",
        pending: action === "submit",
        error: null,
      });
      expect(onSettled).not.toHaveBeenCalled();
      expect(report).toHaveBeenCalledOnce();
    } finally {
      await act(async () => {
        finish("new");
        await next;
      });
    }
  },
);
