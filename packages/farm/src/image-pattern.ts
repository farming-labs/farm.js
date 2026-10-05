interface ImagePathPattern {
  pathname?: string;
}

// Policy objects own the cache, not untrusted request paths. Weak keys allow
// replaced configurations to be collected; checking pathname also supports
// callers that pass mutable resolved configurations directly to the handler.
const compiledPatterns = new WeakMap<ImagePathPattern, { pathname: string; matcher: RegExp }>();

export function matchesImagePathPattern(value: string, pattern: ImagePathPattern): boolean {
  const pathname = pattern.pathname ?? "/**";
  let compiled = compiledPatterns.get(pattern);
  if (!compiled || compiled.pathname !== pathname) {
    const escaped = pathname.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    // eslint-disable-next-line no-control-regex -- Internal sentinel for the existing ** glob grammar.
    const source = escaped.replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*");
    compiled = { pathname, matcher: new RegExp(`^${source}$`) };
    compiledPatterns.set(pattern, compiled);
  }
  return compiled.matcher.test(value);
}
