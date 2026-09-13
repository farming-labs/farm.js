/** Instance defaults, resolved once per call before cache lookup or dispatch. */
export type ClientHeaders =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>);

/** Snapshot synchronous defaults immediately; keep async resolvers local to the call. */
export function resolveClientHeaders(source?: ClientHeaders): Headers | Promise<Headers> {
  const value = typeof source === "function" ? source() : source;
  if (value && typeof (value as Promise<Record<string, string>>).then === "function") {
    return Promise.resolve(value).then((headers) => new Headers(headers));
  }
  return new Headers(value as Record<string, string> | undefined);
}
