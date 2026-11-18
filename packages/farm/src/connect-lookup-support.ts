/**
 * Whether this runtime's `node:http` calls the `lookup` option, which the address check
 * runs in. Node does. Bun 1.2 doesn't call it at all, and Deno and Cloudflare Workers aren't
 * verified, so all three are treated as unsupported rather than fetching unchecked.
 */
export function isConnectLookupSupported(): boolean {
  const runtime = globalThis as {
    process?: { versions?: Record<string, string | undefined> };
    navigator?: { userAgent?: string };
  };
  const versions = runtime.process?.versions;
  if (typeof versions?.node !== "string" || versions.bun || versions.deno) return false;
  return runtime.navigator?.userAgent !== "Cloudflare-Workers";
}
