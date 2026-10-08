// Shared by the correctness tests and selector-only diagnostic. The baseline is
// the selector from 72cdabb6; both arms use the current complete path matcher.
export const baselineSelector = `function matchRouteSlots(pathname, interceptFrom) {
  const groups = new Map();
  for (const slot of routeSlots) {
    if (!matchesRoutePrefix(pathname, slot.ownerPattern)) continue;
    const key = slot.ownerPattern + ":" + slot.name;
    const entries = groups.get(key) || [];
    entries.push(slot);
    groups.set(key, entries);
  }

  const normalizedFrom =
    typeof interceptFrom === "string" && interceptFrom.startsWith("/")
      ? new URL(interceptFrom, "http://farm.local").pathname
      : null;
  const matches = [];

  for (const entries of groups.values()) {
    const candidates = entries
      .filter(function(entry) { return !entry.fallback; })
      .filter(function(entry) {
        return !entry.interception ||
          (normalizedFrom && matchesRoutePrefix(normalizedFrom, entry.ownerPattern));
      })
      .map(function(entry) {
        return {
          entry: entry,
          params: matchRuntimePathPattern(entry.pattern, pathname),
        };
      })
      .filter(function(candidate) { return candidate.params !== null; })
      .sort(function(left, right) {
        if (left.entry.interception !== right.entry.interception) {
          return left.entry.interception ? -1 : 1;
        }
        return routeSlotSpecificity(right.entry) - routeSlotSpecificity(left.entry);
      });

    if (candidates[0]) {
      matches.push({ ...candidates[0].entry, params: candidates[0].params });
      continue;
    }

    const fallback = entries.find(function(entry) { return entry.fallback; });
    if (fallback) matches.push({ ...fallback, params: {} });
  }

  return matches.sort(function(left, right) {
    const ownerDepth =
      left.ownerPattern.split("/").filter(Boolean).length -
      right.ownerPattern.split("/").filter(Boolean).length;
    return ownerDepth || left.name.localeCompare(right.name);
  });
}`;

export function runtimeSources(source) {
  const emit = (raw) => new Function("return `" + raw + "`;")();
  const slice = (start, end) => {
    const from = source.indexOf(start),
      to = source.indexOf(end, from);
    if (from < 0 || to <= from) throw new Error(`Missing generated source: ${start}`);
    return source.slice(from, to);
  };
  const generator = slice(
    "export function generateRuntimePathMatcherSource(): string {",
    "export function generateRedirectInterpolationSource",
  );
  const matcher = emit(
    generator.slice(generator.indexOf("return `") + 8, generator.indexOf("`.trim();")),
  );
  const selectorStart = source.indexOf("function matchRouteSlots(pathname, interceptFrom) {");
  const helperStart = source.lastIndexOf(
    "function matchesRoutePrefix(pathname, pattern) {",
    selectorStart,
  );
  if (helperStart < 0) throw new Error("Missing slot prefix helper");
  const helpers = emit(source.slice(helperStart, selectorStart));
  const selector = emit(
    slice("function matchRouteSlots(pathname, interceptFrom) {", "\nfunction hasLocalRequestRoute"),
  );
  // Allow the unoptimized source so the work-count regressions can run red.
  const table = source.includes("const preparedRouteSlots = new Map();")
    ? emit(slice("const preparedRouteSlots = new Map();", "// Route-level error boundaries"))
    : "";
  return {
    baseline: matcher + helpers + baselineSelector,
    candidate: matcher + helpers + table + selector,
  };
}

export function signature(matches) {
  return matches.map((match) => ({
    ...match,
    captures: Object.getOwnPropertySymbols(match.params).map((key) => [
      key.description,
      Object.getOwnPropertyDescriptor(match.params, key),
    ]),
  }));
}
