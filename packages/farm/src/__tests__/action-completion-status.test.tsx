/** @vitest-environment jsdom */
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServerFn } from "../server-fn";
import { useAction, useServerFn, type UseServerFnReturn } from "../server-fn-client";

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

for (const hook of ["useAction", "useServerFn"] as const) {
  for (const latestFails of [false, true]) {
    it.each([
      [2, 1, 0],
      [2, 0, 1],
      [1, 2, 0],
      [0, 2, 1],
      [1, 0, 2],
      [0, 1, 2],
    ])(
      `${hook} preserves latest completion (fails=${latestFails}, order=%s,%s,%s)`,
      async (...order) => {
        const reads = [deferred(), deferred(), deferred()];
        let next = 0;
        const target = createServerFn({ handler: () => reads[next++].promise });
        const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onSettled: vi.fn() };
        const latestError = new Error("latest failed");
        let action!: UseServerFnReturn<unknown, number>;
        function View() {
          if (hook === "useAction") {
            const value = useAction(target, callbacks);
            action = { ...value, submit: value };
          } else action = useServerFn(target, callbacks);
          return null;
        }
        await act(async () => root.render(createElement(StrictMode, null, createElement(View))));
        const calls: Promise<number | Error>[] = [];
        try {
          await act(async () => {
            for (let i = 0; i < 3; i++) calls.push(action.submit().catch((error: Error) => error));
          });
          let latestDone = false;
          for (const [step, index] of order.entries()) {
            await act(async () => {
              if (index === 2 && latestFails) reads[index].reject(latestError);
              else if (index === 1) reads[index].reject(new Error("older failed"));
              else reads[index].resolve(index);
              await calls[index];
            });
            if (index === 2) latestDone = true;
            expect(action.pending).toBe(step < 2);
            expect(action.status).toBe(
              latestDone ? (latestFails ? "error" : "success") : "pending",
            );
            if (latestDone) {
              expect(action.result).toBe(latestFails ? null : 2);
              expect(action.error).toBe(latestFails ? latestError : null);
            }
          }
          expect(callbacks.onSuccess).toHaveBeenCalledTimes(latestFails ? 0 : 1);
          expect(callbacks.onError).toHaveBeenCalledTimes(latestFails ? 1 : 0);
          expect(callbacks.onSettled).toHaveBeenCalledExactlyOnceWith(
            latestFails ? null : 2,
            latestFails ? latestError : null,
          );
        } finally {
          await act(async () => {
            reads.forEach((read) => read.resolve(99));
            await Promise.all(calls);
          });
        }
      },
    );
  }
}

it("returns to pending for a newer submission and preserves reset isolation", async () => {
  const reads = [deferred(), deferred(), deferred()];
  let next = 0;
  const target = createServerFn({ handler: () => reads[next++].promise });
  let action!: UseServerFnReturn<unknown, number>;
  function View() {
    action = useServerFn(target, { initialResult: 5 });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  const calls: Promise<number>[] = [];
  try {
    await act(async () => {
      calls.push(action.submit());
    });
    await act(async () => {
      reads[0].resolve(1);
      await calls[0];
    });
    expect(action.status).toBe("success");
    await act(async () => {
      calls.push(action.submit());
    });
    expect(action.status).toBe("pending");
    await act(async () => {
      action.reset();
      calls.push(action.submit());
    });
    await act(async () => {
      reads[1].resolve(2);
      await calls[1];
    });
    expect(action.status).toBe("pending");
    expect(action.pending).toBe(true);
  } finally {
    await act(async () => {
      reads.forEach((read) => read.resolve(3));
      await Promise.all(calls);
    });
  }
  expect(action).toMatchObject({ status: "success", pending: false, result: 3 });
});
