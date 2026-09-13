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

it.each(["mutation", "fetcher"] as const)(
  "preserves the latest %s result across every completion order",
  async (kind) => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const orders = [
      [2, 1, 0],
      [2, 0, 1],
      [1, 2, 0],
      [0, 2, 1],
      [1, 0, 2],
      [0, 1, 2],
    ];
    for (const latestFails of [false, true]) {
      for (const order of orders) {
        const reads = [deferred(), deferred(), deferred()];
        const error = new Error("latest failed");
        let index = 0;
        const target = () => reads[index++]!.promise;
        const onSuccess = vi.fn();
        const onError = vi.fn();
        const onSettled = vi.fn();
        const options = { onSuccess, onError, onSettled };
        let state!: {
          run: () => Promise<string>;
          pending: boolean;
          status: MutationStatus;
          data: string | null;
          error: Error | null;
        };
        function MutationView() {
          const m = useMutation(target, options);
          state = { ...m, run: m.mutateAsync };
          return null;
        }
        function FetcherView() {
          const m = useFetcher(target, options);
          state = { ...m, run: m.submitAsync };
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
          const pending: Promise<string | Error>[] = [];
          await act(async () => {
            for (let i = 0; i < 3; i++) pending.push(state.run().catch((e: Error) => e));
          });
          let latestDone = false;
          for (const [step, i] of order.entries()) {
            await act(async () => {
              if (i === 2 && latestFails) reads[i]!.reject(error);
              else if (i === 1) reads[i]!.reject(new Error("older failed"));
              else reads[i]!.resolve(String(i));
              await pending[i];
            });
            if (i === 2) latestDone = true;
            expect(state.pending).toBe(step !== 2);
            expect(state.status).toBe(latestDone ? (latestFails ? "error" : "success") : "pending");
            if (latestDone) {
              expect(state.data).toBe(latestFails ? null : "2");
              expect(state.error).toBe(latestFails ? error : null);
            }
          }
          expect(onSuccess).toHaveBeenCalledTimes(latestFails ? 0 : 1);
          expect(onError).toHaveBeenCalledTimes(latestFails ? 1 : 0);
          expect(onSettled).toHaveBeenCalledOnce();
        } finally {
          await act(async () => root.unmount());
          for (const read of reads) read.resolve("cleanup");
        }
      }
    }
  },
);
