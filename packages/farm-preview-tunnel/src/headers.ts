/**
 * Present on every request a preview agent sends to the local app. Farm's dev server refuses
 * developer-only files and tools for requests that carry it.
 */
export const PREVIEW_REQUEST_HEADER = "x-farm-preview";

const STANDARD_HOP_BY_HOP_HEADERS = [
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

/**
 * Headers the gateway's hosting platform adds to each request, such as Vercel's
 * `x-vercel-oidc-token`, a credential for the gateway's own deployment. They describe the
 * gateway, not the visitor, so a preview never hands them to the local app.
 */
export function isGatewayPlatformHeader(name: string): boolean {
  return name.toLowerCase().startsWith("x-vercel-");
}

export function getHopByHopHeaderNames(
  connection: string | string[] | null | undefined,
): Set<string> {
  const names = new Set<string>(STANDARD_HOP_BY_HOP_HEADERS);
  const values = Array.isArray(connection) ? connection : connection ? [connection] : [];
  for (const value of values) {
    for (const name of value.split(",")) {
      const normalized = name.trim().toLowerCase();
      if (normalized) names.add(normalized);
    }
  }
  return names;
}

export function getRecordHeader(
  headers: Record<string, string | string[]>,
  expectedName: string,
): string | string[] | undefined {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === expectedName) return value;
  }
  return undefined;
}
