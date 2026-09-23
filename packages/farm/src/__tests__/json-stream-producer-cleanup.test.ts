// @vitest-environment node
import { expect, it, vi } from "vitest";
import { jsonStream } from "../api/transport";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it.each(["value", "done", "error"] as const)(
  "ignores a late %s after cancellation without closing the producer twice",
  async (outcome) => {
    const pending = deferred<IteratorResult<string>>();
    const started = deferred<void>();
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const response = jsonStream({
      [Symbol.asyncIterator]() {
        return {
          next() {
            started.resolve();
            return pending.promise;
          },
          return: close,
        };
      },
    });
    const reader = response.body!.getReader();
    const reading = reader.read();
    await started.promise;
    await reader.cancel("view closed");
    if (outcome === "error") pending.reject(new Error("late source failure"));
    else pending.resolve({ done: outcome === "done", value: "late event" });
    await reading;
    // One turn lets the already-resolved pull and its cleanup finish.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith("view closed");
    reader.releaseLock();
  },
);

it.each(["resolve", "reject"] as const)(
  "shares pending failure cleanup with cancellation when cleanup will %s",
  async (outcome) => {
    const cleaning = deferred<void>();
    const cleanup = deferred<IteratorResult<string>>();
    const failure = new Error("source failed");
    const cleanupFailure = new Error("cleanup failed");
    const close = vi.fn(() => {
      cleaning.resolve();
      return cleanup.promise;
    });
    const response = jsonStream({
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw failure;
          },
          return: close,
        };
      },
    });
    const reader = response.body!.getReader();
    const reading = reader.read();
    await cleaning.promise;
    let settled = false;
    const cancelling = reader.cancel("disconnected").then(
      () => {
        settled = true;
      },
      (error) => {
        settled = true;
        return error;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    if (outcome === "reject") cleanup.reject(cleanupFailure);
    else cleanup.resolve({ done: true, value: undefined });
    expect(await cancelling).toBe(outcome === "reject" ? cleanupFailure : undefined);
    await reading;
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(failure);
    reader.releaseLock();
  },
);

it("keeps the source error when cleanup rejects without cancellation", async () => {
  const failure = new Error("source failed");
  const close = vi.fn(async () => {
    throw new Error("cleanup failed");
  });
  const response = jsonStream({
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          throw failure;
        },
        return: close,
      };
    },
  });
  await expect(response.text()).rejects.toBe(failure);
  expect(close).toHaveBeenCalledOnce();
});
