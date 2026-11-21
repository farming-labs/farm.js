export function isSigningSecret(value: unknown): value is string {
  if (typeof value !== "string" || !/^whsec_[A-Za-z0-9+/]{32,128}={0,2}$/.test(value)) return false;
  const encoded = value.slice(6);
  return encoded.length % 4 === 0 && btoa(atob(encoded)) === encoded;
}
