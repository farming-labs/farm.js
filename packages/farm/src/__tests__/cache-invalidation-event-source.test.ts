import { afterEach, describe, expect, it, vi } from "vitest";
import { enableCrossTabCacheInvalidation } from "../cache-invalidation-broadcast";
import { enableLiveCacheInvalidation } from "../cache-invalidation-event-source";
import {
  encodeFarmCacheInvalidations,
  subscribeFarmCacheInvalidation,
} from "../cache-invalidation";

class StubEventSource {
  static instances: StubEventSource[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(
    public url: string,
    public options?: EventSourceInit,
  ) {
    StubEventSource.instances.push(this);
  }

  emit(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  close(): void {
    this.closed = true;
  }
}

class StubBroadcastChannel {
  static instances: StubBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(public name: string) {
    StubBroadcastChannel.instances.push(this);
  }

  postMessage(): void {}
  close(): void {}
}

describe("live cache invalidation", () => {
  afterEach(() => {
    StubEventSource.instances = [];
    StubBroadcastChannel.instances = [];
    vi.unstubAllGlobals();
  });

  it("is a no-op during server rendering", () => {
    vi.stubGlobal("EventSource", undefined);
    const dispose = enableLiveCacheInvalidation({ url: "/api/cache-events" });
    expect(() => dispose()).not.toThrow();
  });

  it("supports an absolute URL when a browser location is unavailable", () => {
    vi.stubGlobal("EventSource", StubEventSource);
    vi.stubGlobal("location", undefined);

    const dispose = enableLiveCacheInvalidation({
      url: "https://events.example.com/cache",
    });

    expect(StubEventSource.instances[0]!.url).toBe("https://events.example.com/cache");
    dispose();
  });

  it("applies valid events through the shared invalidation bus", () => {
    vi.stubGlobal("EventSource", StubEventSource);
    const seen: string[] = [];
    const unsubscribe = subscribeFarmCacheInvalidation((key) => seen.push(key));
    const dispose = enableLiveCacheInvalidation({ url: "/api/cache-events" });
    const source = StubEventSource.instances[0]!;

    source.emit(encodeFarmCacheInvalidations(["products", "orders"])!);
    source.emit("not-an-encoded-batch");

    expect(seen).toEqual(["products", "orders"]);
    expect(source.url).toBe("http://localhost:3000/api/cache-events");
    unsubscribe();
    dispose();
  });

  it("shares one EventSource and closes it after the last disposer", () => {
    vi.stubGlobal("EventSource", StubEventSource);
    const first = enableLiveCacheInvalidation({
      url: "/api/cache-events",
      withCredentials: true,
    });
    const second = enableLiveCacheInvalidation({
      url: "http://localhost:3000/api/cache-events",
      withCredentials: true,
    });

    expect(StubEventSource.instances).toHaveLength(1);
    const source = StubEventSource.instances[0]!;
    expect(source.options).toEqual({ withCredentials: true });
    first();
    expect(source.closed).toBe(false);
    second();
    expect(source.closed).toBe(true);
  });

  it("does not echo live server events through the cross-tab bridge", () => {
    vi.stubGlobal("EventSource", StubEventSource);
    vi.stubGlobal("BroadcastChannel", StubBroadcastChannel);
    const disposeCrossTab = enableCrossTabCacheInvalidation();
    const channel = StubBroadcastChannel.instances[0]!;
    const post = vi.spyOn(channel, "postMessage");
    const disposeLive = enableLiveCacheInvalidation({ url: "/api/cache-events" });

    StubEventSource.instances[0]!.emit(encodeFarmCacheInvalidations(["products"])!);

    expect(post).not.toHaveBeenCalled();
    disposeLive();
    disposeCrossTab();
  });
});
