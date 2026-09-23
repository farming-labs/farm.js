import {
  decodeFarmCacheInvalidations,
  encodeFarmCacheInvalidations,
  notifyFarmCacheInvalidation,
  subscribeFarmCacheInvalidation,
} from "./cache-invalidation";

export const FARM_CACHE_INVALIDATION_CHANNEL = "farm:cache-invalidation";

export type CrossTabCacheInvalidationOptions = {
  /** Override the BroadcastChannel name, e.g. to isolate multiple apps on one origin. */
  channelName?: string;
};

type ActiveBridge = {
  channelName: string;
  refCount: number;
  teardown: () => void;
};

// One bridge per tab regardless of how many callers enable it: a second
// BroadcastChannel in the same tab would receive this tab's own posts and
// re-apply every local invalidation as if it were remote.
//
// The guard lives on globalThis under the same registry the invalidation bus
// uses, so duplicate copies of this module share it. A module-local guard only
// protects the copy that declares it, while the bus underneath is global, so a
// second copy would build its own bridge and the two would echo one local
// invalidation between them without end (each bridge's applyingRemote flag is
// private to its own closure and cannot suppress the other's replay).
const FARM_CACHE_INVALIDATION_BRIDGE = Symbol.for("farm.cacheInvalidationBridge");
const bridgeGlobal = globalThis as typeof globalThis & {
  [FARM_CACHE_INVALIDATION_BRIDGE]?: ActiveBridge;
};

/**
 * Bridge the cache invalidation bus across tabs of the same origin.
 *
 * Local invalidations are posted to a BroadcastChannel and applied in every
 * other tab through the normal invalidation path, so mounted stale queries
 * there refetch on their own. Only invalidation keys cross the channel, never
 * cached data, which keeps private and credentialed cache scoping untouched.
 *
 * Opt-in and idempotent. Returns a disposer; a no-op where BroadcastChannel
 * is unavailable (server rendering, older browsers).
 */
export function enableCrossTabCacheInvalidation(
  options: CrossTabCacheInvalidationOptions = {},
): () => void {
  if (typeof BroadcastChannel !== "function") return () => {};

  const channelName = options.channelName ?? FARM_CACHE_INVALIDATION_CHANNEL;
  const existing = bridgeGlobal[FARM_CACHE_INVALIDATION_BRIDGE];
  let bridge: ActiveBridge;
  if (existing) {
    if (existing.channelName !== channelName) {
      throw new Error(
        `Cross-tab cache invalidation is already enabled on channel "${existing.channelName}".`,
      );
    }
    existing.refCount += 1;
    bridge = existing;
  } else {
    bridge = createBridge(channelName);
    bridgeGlobal[FARM_CACHE_INVALIDATION_BRIDGE] = bridge;
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    // Release the bridge this caller actually claimed, so a disposer that
    // outlives a teardown/re-enable cycle cannot decrement a later bridge.
    bridge.refCount -= 1;
    if (bridge.refCount === 0) {
      bridge.teardown();
      if (bridgeGlobal[FARM_CACHE_INVALIDATION_BRIDGE] === bridge) {
        bridgeGlobal[FARM_CACHE_INVALIDATION_BRIDGE] = undefined;
      }
    }
  };
}

function createBridge(channelName: string): ActiveBridge {
  const channel = new BroadcastChannel(channelName);
  let applyingRemote = false;
  let pending: string[] = [];
  let flushScheduled = false;
  let closed = false;

  const flush = () => {
    flushScheduled = false;
    if (closed || pending.length === 0) return;
    const encoded = encodeFarmCacheInvalidations(pending);
    pending = [];
    if (encoded !== null) channel.postMessage(encoded);
  };

  const unsubscribe = subscribeFarmCacheInvalidation((key) => {
    if (applyingRemote || closed) return;
    // A mutation can invalidate several keys back to back; batch them into
    // one message per microtask instead of one post per key.
    pending.push(key);
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flush);
    }
  });

  channel.onmessage = (event: MessageEvent) => {
    const keys = decodeFarmCacheInvalidations(
      typeof event.data === "string" ? event.data : undefined,
    );
    if (keys.length === 0) return;
    applyingRemote = true;
    try {
      for (const key of keys) notifyFarmCacheInvalidation(key);
    } finally {
      applyingRemote = false;
    }
  };

  return {
    channelName,
    refCount: 1,
    teardown() {
      closed = true;
      pending = [];
      unsubscribe();
      channel.onmessage = null;
      channel.close();
    },
  };
}
