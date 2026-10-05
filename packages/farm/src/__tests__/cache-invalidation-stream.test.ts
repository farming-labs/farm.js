import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyFarmCacheInvalidation } from "../cache-invalidation";
import { createFarmCacheInvalidationStream } from "../cache-invalidation-stream";

const decoder = new TextDecoder();
const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const result = await reader.read();
  return result.value ? decoder.decode(result.value) : "";
}

afterEach(async () => {
  await Promise.all(readers.splice(0).map((reader) => reader.cancel()));
});

describe("cache invalidation event stream", () => {
  it("keeps delivering when the consumer drains each batch", async () => {
    const response = createFarmCacheInvalidationStream({ heartbeatIntervalMs: false });
    const reader = response.body!.getReader();
    readers.push(reader);
    await readText(reader);
    for (let i = 0; i < 1_000; i++) {
      const key = `${i}:${"x".repeat(1_000)}`;
      notifyFarmCacheInvalidation(key);
      expect(await readText(reader)).toBe(`data: ${encodeURIComponent(JSON.stringify([key]))}\n\n`);
    }
  });

  it("bounds encoded expansion and filters before applying buffer limits", async () => {
    const response = createFarmCacheInvalidationStream({
      heartbeatIntervalMs: false,
      filter: (key) => !key.startsWith("private:"),
    });
    const reader = response.body!.getReader();
    await readText(reader);
    notifyFarmCacheInvalidation(`private:${"x".repeat(100_000)}`);
    notifyFarmCacheInvalidation("allowed");
    expect(await readText(reader)).toContain("allowed");
    const failure = expect(reader.read()).rejects.toThrow("buffer limit");
    notifyFarmCacheInvalidation("界".repeat(10_000));
    await failure;
  });

  it("cleans up when a filter aborts its own stream", async () => {
    const abort = new AbortController();
    const response = createFarmCacheInvalidationStream({
      signal: abort.signal,
      heartbeatIntervalMs: false,
      filter: () => {
        abort.abort();
        return true;
      },
    });
    const reader = response.body!.getReader();
    await readText(reader);
    notifyFarmCacheInvalidation("abort:filter");
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });

  it("bounds unread output and removes the invalidation listener on overflow", async () => {
    const abort = new AbortController();
    let filterCalls = 0;
    const response = createFarmCacheInvalidationStream({
      signal: abort.signal,
      heartbeatIntervalMs: false,
      filter: () => {
        filterCalls++;
        return true;
      },
    });
    try {
      for (let i = 0; i < 1_000; i++) {
        notifyFarmCacheInvalidation(`${i}:${"x".repeat(1_000)}`);
        await Promise.resolve();
      }
      const calls = filterCalls;
      notifyFarmCacheInvalidation("after:overflow");
      expect(filterCalls).toBe(calls);
      await expect(response.body!.getReader().read()).rejects.toThrow("buffer limit");
    } finally {
      abort.abort();
    }
  });

  it("bounds pending keys before the microtask flush and rejects oversized keys", async () => {
    for (const keys of [
      Array.from({ length: 1_025 }, (_, i) => `key:${i}`),
      ["x".repeat(65_536)],
    ]) {
      const abort = new AbortController();
      const response = createFarmCacheInvalidationStream({
        signal: abort.signal,
        heartbeatIntervalMs: false,
      });
      try {
        for (const key of keys) notifyFarmCacheInvalidation(key);
        await expect(response.body!.getReader().read()).rejects.toThrow("buffer limit");
      } finally {
        abort.abort();
      }
    }
  });

  it("coalesces repeated pending keys without treating duplicates as overflow", async () => {
    const response = createFarmCacheInvalidationStream({ heartbeatIntervalMs: false });
    const reader = response.body!.getReader();
    readers.push(reader);
    await readText(reader);
    for (let i = 0; i < 10_000; i++) notifyFarmCacheInvalidation("same:key");
    expect(await readText(reader)).toBe(`data: ${encodeURIComponent('["same:key"]')}\n\n`);
    notifyFarmCacheInvalidation("later:key");
    expect(await readText(reader)).toContain(encodeURIComponent('["later:key"]'));
  });

  it("does not queue heartbeat history for an unread stream", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const response = createFarmCacheInvalidationStream({
      signal: abort.signal,
      heartbeatIntervalMs: 20,
    });
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      abort.abort();
      const reader = response.body!.getReader();
      expect(await readText(reader)).toContain(": connected");
      expect(await reader.read()).toEqual({ done: true, value: undefined });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      abort.abort();
      vi.useRealTimers();
    }
  });

  it("batches encoded invalidations into an SSE response", async () => {
    const response = createFarmCacheInvalidationStream({ heartbeatIntervalMs: false });
    const reader = response.body!.getReader();
    readers.push(reader);

    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(await readText(reader)).toBe(": connected\nretry: 3000\n\n");

    notifyFarmCacheInvalidation("products:1");
    notifyFarmCacheInvalidation("products:2");
    notifyFarmCacheInvalidation("products:1");

    expect(await readText(reader)).toBe(
      `data: ${encodeURIComponent(JSON.stringify(["products:1", "products:2"]))}\n\n`,
    );
  });

  it("announces the reconnect delay and keeps the stream alive", async () => {
    vi.useFakeTimers();
    const response = createFarmCacheInvalidationStream({
      heartbeatIntervalMs: 20,
      retryMs: 1_200,
    });
    const reader = response.body!.getReader();
    readers.push(reader);

    try {
      expect(await readText(reader)).toBe(": connected\nretry: 1200\n\n");
      const heartbeat = readText(reader);
      await vi.advanceTimersByTimeAsync(20);
      expect(await heartbeat).toBe(": heartbeat\n\n");
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters private keys before they enter the stream", async () => {
    const response = createFarmCacheInvalidationStream({
      heartbeatIntervalMs: false,
      filter: (key) => key.startsWith("org:allowed:"),
    });
    const reader = response.body!.getReader();
    readers.push(reader);
    await readText(reader);

    notifyFarmCacheInvalidation("org:other:orders");
    notifyFarmCacheInvalidation("org:allowed:orders");

    expect(await readText(reader)).toContain(encodeURIComponent('["org:allowed:orders"]'));
  });

  it("unsubscribes and closes when the request aborts", async () => {
    const abortController = new AbortController();
    const response = createFarmCacheInvalidationStream({
      heartbeatIntervalMs: false,
      signal: abortController.signal,
    });
    const reader = response.body!.getReader();
    readers.push(reader);
    await readText(reader);

    abortController.abort();
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(() => notifyFarmCacheInvalidation("after:abort")).not.toThrow();
  });

  it("unsubscribes when the response consumer cancels", async () => {
    let filterCalls = 0;
    const response = createFarmCacheInvalidationStream({
      heartbeatIntervalMs: false,
      filter() {
        filterCalls += 1;
        return true;
      },
    });
    const reader = response.body!.getReader();
    readers.push(reader);
    await readText(reader);

    await reader.cancel();
    notifyFarmCacheInvalidation("after:cancel");

    expect(filterCalls).toBe(0);
  });

  it("starts closed when the owning request was already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const response = createFarmCacheInvalidationStream({
      signal: abortController.signal,
    });

    await expect(response.body!.getReader().read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
