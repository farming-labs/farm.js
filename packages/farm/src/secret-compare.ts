/**
 * Constant-time comparison of two secret strings. Unlike `===`, which stops at
 * the first differing character, this always inspects every character of equal
 * length inputs, so it does not leak (through timing) how many leading
 * characters of a guessed secret are correct.
 *
 * Pure JS on purpose: cron and workflow routes run in every deployment runtime,
 * including edge runtimes like Cloudflare Workers where `node:crypto` is not
 * available. The length check is not a leak of the secret itself (the token
 * length is a fixed, non-secret property of the configured value).
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
