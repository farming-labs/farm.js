export function getHashTargetElement(hash: string): Element | null {
  // A fragment is not a CSS selector. Match by decoded id, raw id, then the
  // legacy anchor name so SPA navigation follows native browser semantics.
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment) return null;

  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // Keep the raw fragment when its percent-encoding is malformed.
  }

  return (
    document.getElementById(decoded) ||
    document.getElementById(fragment) ||
    document.getElementsByName(decoded)[0] ||
    null
  );
}
