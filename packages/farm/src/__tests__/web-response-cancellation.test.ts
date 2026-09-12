// @vitest-environment node
import { expect, it, vi } from "vitest";
import { after, _runWithAfterRequest } from "../after";
import { createFarmProductionLifecycle } from "../production-lifecycle";
import { resolveFarmServerConfig } from "../server-http";

it.each(["resolve", "reject"] as const)(
  "finishes Web response bookkeeping before producer cleanup can %s",
  async (outcome) => {
    let settleCleanup!: () => void;
    const cleanupError = new Error("cleanup failed");
    const cleanup = new Promise<void>((resolve, reject) => {
      settleCleanup = () => (outcome === "resolve" ? resolve() : reject(cleanupError));
    });
    const cancel = vi.fn(() => cleanup);
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    const callback = vi.fn();
    let lifetime!: Promise<void>;
    const lifecycle = createFarmProductionLifecycle({ server: resolveFarmServerConfig(undefined) });
    const response = await lifecycle.runRequest(() =>
      _runWithAfterRequest(
        new Request("https://farm.test/"),
        () => {
          after(callback);
          return new Response(source);
        },
        {
          waitUntil(promise) {
            lifetime = promise;
          },
        },
      ),
    );
    // Reading starts another pull, so also cover cancellation during a read
    // and repeated completion notifications from nested wrappers.
    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    const reason = new Error("consumer disconnected");
    let settled = false;
    let failure: unknown;
    const cancelling = reader
      .cancel(reason)
      .catch((error) => {
        failure = error;
      })
      .finally(() => {
        settled = true;
      });
    try {
      expect(cancel).toHaveBeenCalledWith(reason);
      await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
      await lifetime;
      expect(lifecycle.activeRequests).toBe(0);
      await expect(lifecycle.waitForIdle(10)).resolves.toBe(true);
      expect(settled).toBe(false);
      expect(source.locked).toBe(false);
    } finally {
      settleCleanup();
      await cancelling;
      reader.releaseLock();
      await lifecycle.close();
    }
    expect(failure).toBe(outcome === "reject" ? cleanupError : undefined);
    expect(callback).toHaveBeenCalledOnce();
    expect(lifecycle.activeRequests).toBe(0);
  },
);

it.each(["after", "lifecycle"] as const)(
  "completes %s on cancellation with a buffered chunk and no pending read",
  async (kind) => {
    let finish!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const cancel = vi.fn(() => cleanup);
    const original = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel,
      }),
    );
    const callback = vi.fn();
    const lifecycle = createFarmProductionLifecycle({ server: resolveFarmServerConfig(undefined) });
    const response =
      kind === "after"
        ? await _runWithAfterRequest(new Request("https://farm.test/"), () => {
            after(callback);
            return original;
          })
        : await lifecycle.runRequest(() => original);
    // Flush the automatic pull of the already-queued chunk without consuming
    // the wrapper's buffer and triggering another read.
    await Promise.resolve();
    const cancelling = response.body!.cancel();
    try {
      expect(cancel).toHaveBeenCalledOnce();
      if (kind === "after") await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
      else expect(lifecycle.activeRequests).toBe(0);
      expect(original.body!.locked).toBe(false);
    } finally {
      finish();
      await cancelling;
      await lifecycle.close();
    }
  },
);
