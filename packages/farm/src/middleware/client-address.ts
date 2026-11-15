/**
 * The caller's address a development middleware request resolved, keyed by its Node request.
 *
 * Production middleware reads a web Request whose `socket.remoteAddress` Farm sets from the last
 * `X-Forwarded-For` hop under `server.trustProxy` (withFarmRequestClientAddress). Development
 * middleware reads the Node request itself, whose socket is the proxy's connection, so the
 * address it resolves the same way is kept here for the readers that need it, such as
 * rateLimit()'s default bucket.
 */
const resolvedClientAddresses = new WeakMap<object, string>();

/** @internal Record the address a trusted proxy names for this development request. */
export function setFarmMiddlewareClientAddress(request: object, address: string): void {
  resolvedClientAddresses.set(request, address);
}

/** @internal The caller's address for a middleware request, as the production runtime resolves it. */
export function getFarmMiddlewareClientAddress(request: unknown): string | undefined {
  if (request && typeof request === "object") {
    const resolved = resolvedClientAddresses.get(request);
    if (resolved) return resolved;
  }
  return (request as { socket?: { remoteAddress?: string } } | undefined)?.socket?.remoteAddress;
}
