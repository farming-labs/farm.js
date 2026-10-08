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

// The prepared selector from b85aee16, retained independently of the candidate.
export const preparedSelector = `function matchRouteSlots(pathname, interceptFrom) {
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
  // Leave empty, fallback-only and ineligible requests unparsed.
  let pathnameSegments;

  for (const entries of groups.values()) {
    const candidates = entries
      .filter(function(entry) { return !entry.fallback; })
      .filter(function(entry) {
        return !entry.interception ||
          (normalizedFrom && matchesRoutePrefix(normalizedFrom, entry.ownerPattern));
      })
      .map(function(entry) {
        const slot = preparedRouteSlots.get(entry);
        if (!pathnameSegments) pathnameSegments = splitRuntimePath(pathname).map(decodeRouteSegment);
        return {
          entry: entry,
          specificity: slot.specificity,
          params: slot.prepared
            ? matchPreparedRuntimePageSegments(slot.prepared, pathnameSegments)
            : matchRuntimePathSegments(slot.segments, pathnameSegments),
        };
      })
      .filter(function(candidate) { return candidate.params !== null; })
      .sort(function(left, right) {
        if (left.entry.interception !== right.entry.interception) {
          return left.entry.interception ? -1 : 1;
        }
        return right.specificity - left.specificity;
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
}
`;

export function runtimeSources(source, routeSlots = []) {
  const slice = (start, end) => {
    const from = source.indexOf(start),
      to = source.indexOf(end, from);
    if (from < 0 || to <= from) throw new Error(`Missing generated source: ${start}`);
    return source.slice(from, to);
  };
  // Evaluate the actual build-time eligibility calculation, not a second copy
  // of its policy. Older sources remain usable for the red regression run.
  const ownerPreparation = source.includes("// Prepare shared slot owners at build time.")
    ? slice("// Prepare shared slot owners at build time.", "const routeSlotImports:")
    : "const sharedSlotOwners = new Set();";
  const sharedSlotOwners = new Function(
    "routeSlots",
    ownerPreparation + ";return sharedSlotOwners;",
  )(routeSlots);
  const emit = (raw, owners = sharedSlotOwners) =>
    new Function("sharedSlotOwners", "return `" + raw + "`;")(owners);
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
  const selector = slice(
    "function matchRouteSlots(pathname, interceptFrom) {",
    "\nfunction hasLocalRequestRoute",
  );
  // Allow the unoptimized source so the work-count regressions can run red.
  const table = source.includes("const preparedRouteSlots = new Map();")
    ? slice("const preparedRouteSlots = new Map();", "// Route-level error boundaries")
    : "";
  return {
    baseline: matcher + helpers + baselineSelector,
    // The prepared baseline holds #1849's route-input work constant and omits
    // only the shared-owner optimization. Empty/unique-owner output is identical.
    prepared: matcher + helpers + emit(table, new Set()) + preparedSelector,
    candidate: matcher + helpers + emit(table) + emit(selector),
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
