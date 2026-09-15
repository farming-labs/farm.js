import { afterEach, describe, expect, it, vi } from "vitest";
import { enableCrossTabCacheInvalidation } from "../cache-invalidation-broadcast";
import { notifyFarmCacheInvalidation, subscribeFarmCacheInvalidation } from "../cache-invalidation";

// A minimal BroadcastChannel that delivers messages to every *other* instance
// with the same name, like the platform API.
class StubBroadcastChannel {
  static instances: StubBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  constructor(public name: string) {
    StubBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    for (const instance of StubBroadcastChannel.instances) {
      if (instance === this || instance.closed || instance.name !== this.name) continue;
      instance.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    this.closed = true;
  }
}

async function microtasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("cross-tab cache invalidation", () => {
  afterEach(() => {
    StubBroadcastChannel.instances = [];
    vi.unstubAllGlobals();
  });

  it("is a no-op without BroadcastChannel support", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const dispose = enableCrossTabCacheInvalidation();
    expect(() => dispose()).not.toThrow();
  });

  it("posts local invalidations batched into one message", async () => {
    vi.stubGlobal("BroadcastChannel", StubBroadcastChannel);
    const dispose = enableCrossTabCacheInvalidation();
    const bridgeChannel = StubBroadcastChannel.instances[0]!;
    const post = vi.spyOn(bridgeChannel, "postMessage");

    notifyFarmCacheInvalidation("product:1");
    notifyFarmCacheInvalidation("product:2");
    await microtasks();

    expect(post).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("applies invalidations from another tab without re-broadcasting them", async () => {
    vi.stubGlobal("BroadcastChannel", StubBroadcastChannel);
    const dispose = enableCrossTabCacheInvalidation();
    const bridgeChannel = StubBroadcastChannel.instances[0]!;
    const post = vi.spyOn(bridgeChannel, "postMessage");

    const seen: string[] = [];
    const unsubscribe = subscribeFarmCacheInvalidation((key) => seen.push(key));

    const otherTab = new StubBroadcastChannel(bridgeChannel.name);
    otherTab.postMessage(encodeURIComponent(JSON.stringify(["product:9"])));
    await microtasks();

    expect(seen).toEqual(["product:9"]);
    expect(post).not.toHaveBeenCalled();

    unsubscribe();
    dispose();
  });

  it("ignores malformed messages", async () => {
    vi.stubGlobal("BroadcastChannel", StubBroadcastChannel);
    const dispose = enableCrossTabCacheInvalidation();
    const bridgeChannel = StubBroadcastChannel.instances[0]!;

    const seen: string[] = [];
    const unsubscribe = subscribeFarmCacheInvalidation((key) => seen.push(key));

    const otherTab = new StubBroadcastChannel(bridgeChannel.name);
    otherTab.postMessage("%%%not-json%%%");
    otherTab.postMessage({ nested: true });
    otherTab.postMessage(encodeURIComponent(JSON.stringify([42, "", "valid"])));
    await microtasks();

    expect(seen).toEqual(["valid"]);
    unsubscribe();
    dispose();
  });

  it("keeps one bridge across repeated enables and tears down on the last dispose", async () => {
    vi.stubGlobal("BroadcastChannel", StubBroadcastChannel);
    const disposeFirst = enableCrossTabCacheInvalidation();
    const disposeSecond = enableCrossTabCacheInvalidation();

    expect(StubBroadcastChannel.instances).toHaveLength(1);
    const bridgeChannel = StubBroadcastChannel.instances[0]!;

    disposeFirst();
    disposeFirst(); // repeated dispose must not steal the remaining enable
    expect(bridgeChannel.closed).toBe(false);

    disposeSecond();
    expect(bridgeChannel.closed).toBe(true);

    notifyFarmCacheInvalidation("product:1");
    await microtasks();
    // The bus keeps working locally after teardown; nothing crosses the channel.
  });

  it("stops posting after dispose even with a flush pending", async () => {
    vi.stubGlobal("BroadcastChannel", StubBroadcastChannel);
    const dispose = enableCrossTabCacheInvalidation();
    const bridgeChannel = StubBroadcastChannel.instances[0]!;
    const post = vi.spyOn(bridgeChannel, "postMessage");

    notifyFarmCacheInvalidation("product:1");
    dispose();
    await microtasks();

    expect(post).not.toHaveBeenCalled();
  });

  it("rejects a second bridge on a different channel name", () => {
    vi.stubGlobal("BroadcastChannel", StubBroadcastChannel);
    const dispose = enableCrossTabCacheInvalidation({ channelName: "app-a" });
    expect(() => enableCrossTabCacheInvalidation({ channelName: "app-b" })).toThrow(
      /already enabled/,
    );
    dispose();
  });
});
