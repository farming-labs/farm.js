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
  "isolates %s failures (target fails=%s, async=%s)",
  async (callback, fails, asyncCallback) => {
    let resolveOlder!: (value: string) => void;
    const older = new Promise<string>((resolve) => {
      resolveOlder = resolve;
    });
    let calls = 0;
    const targetError = new Error("target failed");
    const callbackError = new Error("callback failed");
    const target = createServerFn({
      handler: async () => {
        if (++calls === 1) return older;
        if (fails) throw targetError;
        return "latest";
      },
    });
    const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onSettled: vi.fn() };
    callbacks[callback].mockImplementation(() => {
      if (asyncCallback) return Promise.reject(callbackError);
      throw callbackError;
    });
    let action!: UseServerFnReturn<unknown, string>;
    function View() {
      action = useServerFn(target, {
        ...callbacks,
        initialResult: "before",
        optimistic: () => "draft",
        rollbackOnError: true,
      });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));
    let first!: Promise<string>;
    try {
      await act(async () => {
        first = action.submit();
      });
      await act(async () => {
        const result = action.submit();
        if (fails) await expect(result).rejects.toBe(targetError);
        else await expect(result).resolves.toBe("latest");
      });
      expect({ result: action.result, pending: action.pending, error: action.error }).toEqual({
        pending: true,
        result: fails ? "draft" : "latest",
        error: fails ? targetError : null,
      });
      expect(callbacks.onSuccess).toHaveBeenCalledTimes(fails ? 0 : 1);
      expect(callbacks.onError).toHaveBeenCalledTimes(fails ? 1 : 0);
      expect(callbacks.onSettled).toHaveBeenCalledExactlyOnceWith(
        fails ? null : "latest",
        fails ? targetError : null,
      );
      expect(report).toHaveBeenCalledExactlyOnceWith(callbackError);
    } finally {
      await act(async () => {
        resolveOlder("older");
        await first;
      });
    }
    expect(action.pending).toBe(false);
    expect(callbacks.onSettled).toHaveBeenCalledOnce();
  },
);

it.each([
  ["reset", false],
  ["submit", false],
  ["reset", true],
  ["submit", true],
] as const)(
  "skips stale settlement when an action observer calls %s (target fails=%s)",
  async (operation, fails) => {
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const targetError = new Error("target failed");
    const callbackError = new Error("after reentry");
    let calls = 0;
    const target = createServerFn({
      handler: async () => {
        if (++calls > 1) return pending;
        if (fails) throw targetError;
        return "old";
      },
    });
    const onSettled = vi.fn();
    let action!: UseActionReturn<unknown, string>;
    let next: Promise<string> | undefined;
    const observer = () => {
      if (calls !== 1) return;
      if (operation === "reset") action.reset();
      else next = action();
      throw callbackError;
    };
    function View() {
      action = useAction(target, {
        onSuccess: fails ? undefined : observer,
        onError: fails ? observer : undefined,
        onSettled,
      });
      return null;
    }
    await act(async () => root.render(createElement(View)));
    try {
      await act(async () => {
        if (fails) await expect(action()).rejects.toBe(targetError);
        else await expect(action()).resolves.toBe("old");
      });
      expect({ status: action.status, pending: action.pending, error: action.error }).toEqual({
        status: operation === "reset" ? "idle" : "pending",
        pending: operation === "submit",
        error: null,
      });
      expect(onSettled).not.toHaveBeenCalled();
      expect(report).toHaveBeenCalledExactlyOnceWith(callbackError);
    } finally {
      await act(async () => {
        finish("new");
        await next;
      });
    }
  },
);

it.each([false, true])(
  "preserves throwOnFormError=%s when an error observer throws",
  async (throwOnFormError) => {
    const targetError = new Error("form failed");
    const callbackError = new Error("notification failed");
    const target = createServerFn({
      handler: async () => {
        throw targetError;
      },
    });
    let action!: UseServerFnReturn<unknown, never>;
    function View() {
      action = useServerFn(target, {
        throwOnFormError,
        onError: () => {
          throw callbackError;
        },
      });
      return null;
    }
    await act(async () => root.render(createElement(View)));
    await act(async () => {
      const result = action.formAction(new FormData());
      if (throwOnFormError) await expect(result).rejects.toBe(targetError);
      else await expect(result).resolves.toBeUndefined();
    });
    expect(action.error).toBe(targetError);
    expect(report).toHaveBeenCalledExactlyOnceWith(callbackError);
  },
);
