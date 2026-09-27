import { applyFarmCacheInvalidations, decodeFarmCacheInvalidations } from "./cache-invalidation";

export interface LiveCacheInvalidationOptions {
  /** App-owned SSE endpoint created with createFarmCacheInvalidationStream(). */
  url: string | URL;
  /** Include credentials for a cross-origin EventSource connection. */
  withCredentials?: boolean;
}

type ActiveLiveConnection = {
  refCount: number;
  source: EventSource;
};

const FARM_LIVE_CACHE_INVALIDATION_CONNECTIONS = Symbol.for(
  "farm.liveCacheInvalidationConnections",
);
const connectionGlobal = globalThis as typeof globalThis & {
  [FARM_LIVE_CACHE_INVALIDATION_CONNECTIONS]?: Map<string, ActiveLiveConnection>;
};

function getConnections(): Map<string, ActiveLiveConnection> {
  return (connectionGlobal[FARM_LIVE_CACHE_INVALIDATION_CONNECTIONS] ??= new Map());
}

/**
 * Connect the browser cache to an app-owned invalidation event stream.
 * Native EventSource reconnection handles transient disconnects.
 */
export function enableLiveCacheInvalidation(options: LiveCacheInvalidationOptions): () => void {
  if (typeof EventSource !== "function") return () => {};

  const baseUrl = typeof location === "object" ? location.href : undefined;
  const url = baseUrl ? new URL(String(options.url), baseUrl).href : String(options.url);
  const key = `${url}\0${options.withCredentials === true ? "include" : "same-origin"}`;
  const connections = getConnections();
  let connection = connections.get(key);

  if (connection) {
    connection.refCount += 1;
  } else {
    const source = new EventSource(url, {
      withCredentials: options.withCredentials === true,
    });
    connection = { refCount: 1, source };
    source.onmessage = (event) => {
      const keys = decodeFarmCacheInvalidations(event.data);
      applyFarmCacheInvalidations(keys, "live");
    };
    connections.set(key, connection);
  }

  const claimedConnection = connection;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    claimedConnection.refCount -= 1;
    if (claimedConnection.refCount > 0) return;
    claimedConnection.source.onmessage = null;
    claimedConnection.source.close();
    if (connections.get(key) === claimedConnection) connections.delete(key);
  };
}
