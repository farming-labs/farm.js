/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerFn } from "../server-fn";
import { useAction, useServerFn, type UseServerFnReturn } from "../server-fn-client";

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});
function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe.each(["useAction", "useServerFn"])("%s reset generations", (hook) => {
  it.each(["success", "error"])(
    "ignores pre-reset %s without ending newer work",
    async (outcome) => {
      const reads = [deferred(), deferred(), deferred()];
      let next = 0;
      const target = createServerFn({ handler: async () => reads[next++].promise });
      const onSuccess = vi.fn();
      const onError = vi.fn();
      const onSettled = vi.fn();
      let action!: UseServerFnReturn<unknown, string>;
      function View() {
        const options = { initialResult: "initial", onSuccess, onError, onSettled };
        if (hook === "useAction") {
          const value = useAction(target, options);
          action = { ...value, submit: value };
        } else action = useServerFn(target, options);
        return null;
      }
      await act(async () => root.render(createElement(View)));
      let old!: Promise<string | Error>;
      let current!: Promise<string>;
      let newest!: Promise<string>;
      await act(async () => {
        old = action.submit().catch((error: Error) => error);
      });
      await act(async () => {
        action.reset();
        action.reset();
        current = action.submit();
        newest = action.submit();
      });
      const failure = new Error("old failure");
      try {
        await act(async () => {
          if (outcome === "success") reads[0].resolve("old result");
          else reads[0].reject(failure);
          await old;
        });
        expect(await old).toBe(outcome === "success" ? "old result" : failure);
        expect(action.pending).toBe(true);
        expect(action.status).toBe("pending");
        expect(action.result).toBeNull();
        expect(action.error).toBeNull();
        expect(onSuccess).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(onSettled).not.toHaveBeenCalled();
        await act(async () => {
          reads[1].resolve("current");
          await current;
        });
        // The older generation must not have stolen this generation's count.
        expect(action.pending).toBe(true);
        expect(action.status).toBe("pending");
      } finally {
        await act(async () => {
          reads.forEach((item) => item.resolve("done"));
          await Promise.all([old, current, newest]);
        });
      }
      expect(action.pending).toBe(false);
      expect(action.status).toBe("success");
      expect(action.result).toBe("done");
      expect(onSuccess).toHaveBeenCalledExactlyOnceWith("done");
      expect(onSettled).toHaveBeenCalledExactlyOnceWith("done", null);
    },
  );

  it("leaves reset state untouched when old work settles and preserves normal concurrency", async () => {
    const reads = [deferred(), deferred(), deferred()];
    let next = 0;
    const target = createServerFn({ handler: async () => reads[next++].promise });
    let action!: UseServerFnReturn<unknown, string>;
    function View() {
      if (hook === "useAction") {
        const value = useAction(target, { initialResult: "initial" });
        action = { ...value, submit: value };
      } else action = useServerFn(target, { initialResult: "initial" });
      return null;
    }
    await act(async () => root.render(createElement(View)));
    let first!: Promise<string>;
    let second!: Promise<string>;
    await act(async () => {
      first = action.submit();
      second = action.submit();
    });
    await act(async () => {
      reads[0].resolve("first");
      await first;
    });
    expect(action.pending).toBe(true);
    await act(async () => {
      reads[1].resolve("second");
      await second;
    });
    expect(action.result).toBe("second");
    expect(action.pending).toBe(false);
    let old!: Promise<string>;
    await act(async () => {
      old = action.submit();
      action.reset();
    });
    await act(async () => {
      reads[2].resolve("old");
      await old;
    });
    expect(action.status).toBe("idle");
    expect(action.pending).toBe(false);
    expect(action.result).toBe("initial");
  });
});
