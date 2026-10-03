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
