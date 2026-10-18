// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { drainVitePendingRequests } from "../server/create-server";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const settledWithin = async (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

describe("dev server shutdown and the dependency optimizer", () => {
  it("waits for an in-flight optimizer run that no request is waiting on", async () => {
    // Vite's close cancels an in-flight run and deletes its temporary output
    // directory while Rolldown may still be writing into it, which surfaces as
    // an unhandled "Error during dependency optimization".
    const run = deferred();
    const scan = deferred();
    const server = {
      environments: {
        client: {
          _pendingRequests: new Map(),
          depsOptimizer: {
            scanProcessing: scan.promise,
            metadata: { discovered: { "react-dom/client": { processing: run.promise } } },
          },
        },
        ssr: { _pendingRequests: new Map() },
      },
    } as unknown as ViteDevServer;

    const drained = drainVitePendingRequests(server);
    expect(await settledWithin(drained, 30)).toBe(false);
    scan.resolve();
    expect(await settledWithin(drained, 30)).toBe(false);
    run.resolve();
    expect(await settledWithin(drained, 100)).toBe(true);
  });

  it("does not wait when no optimizer work is in flight", async () => {
    const server = {
      environments: {
        client: { _pendingRequests: new Map(), depsOptimizer: { metadata: { discovered: {} } } },
        ssr: { _pendingRequests: new Map() },
      },
    } as unknown as ViteDevServer;

    expect(await settledWithin(drainVitePendingRequests(server), 50)).toBe(true);
  });
});
