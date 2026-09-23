/**
 * Compare a caller-supplied secret against the configured one without leaking
 * how much of it matched.
 *
 * `===` on strings stops at the first differing character, so the time it takes
 * to reject a guess grows with the length of the correct prefix. Over enough
 * requests that recovers a cron or workflow secret one character at a time. This
 * always inspects every position instead.
 *
 * Deliberately not node:crypto's `timingSafeEqual`: these callers are bundled
 * into the generated Nitro runtime, which also targets edge and browser-like
 * environments where importing node:crypto breaks the build.
 */
export function farmSecretsMatch(provided: string, expected: string): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  // An unset secret must never authorize a request, including an empty guess.
  if (expected.length === 0) return false;

  // Folding the lengths in rejects a wrong-length guess without an early return.
  let mismatch = provided.length ^ expected.length;
  const length = Math.max(provided.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    const providedCode = index < provided.length ? provided.charCodeAt(index) : 0;
    const expectedCode = index < expected.length ? expected.charCodeAt(index) : 0;
    mismatch |= providedCode ^ expectedCode;
  }

  return mismatch === 0;
}
