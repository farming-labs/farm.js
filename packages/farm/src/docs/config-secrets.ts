/**
 * Same rule as the docs engine's config map: scalars under apiKey, token, secret, password,
 * authorization, or credential keys are server-owned, while `*Env` names stay visible.
 */
export function isSecretDocsConfigKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  if (!normalized || normalized.endsWith("env")) return false;
  return /apikey|token|secret|password|authorization|credential/.test(normalized);
}
