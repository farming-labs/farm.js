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
let activeBridge: ActiveBridge | undefined;

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
  if (activeBridge) {
    if (activeBridge.channelName !== channelName) {
      throw new Error(
        `Cross-tab cache invalidation is already enabled on channel "${activeBridge.channelName}".`,
      );
    }
    activeBridge.refCount += 1;
  } else {
    activeBridge = createBridge(channelName);
  }

  let disposed = false;
  return () => {
    if (disposed || !activeBridge) return;
    disposed = true;
    activeBridge.refCount -= 1;
    if (activeBridge.refCount === 0) {
      activeBridge.teardown();
      activeBridge = undefined;
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
