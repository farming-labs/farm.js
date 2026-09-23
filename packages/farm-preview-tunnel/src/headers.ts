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
