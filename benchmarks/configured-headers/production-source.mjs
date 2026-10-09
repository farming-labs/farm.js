import assert from "node:assert/strict";

function replaceOnce(source, pattern, replacement) {
  assert.equal([...source.matchAll(pattern)].length, 1, `unexpected built source: ${pattern}`);
  return source.replace(pattern, replacement);
}

// Fail closed if the built shape changes; never silently time the same matcher.
export function restoreUnpreparedHeaders(source) {
  let baseline = replaceOnce(
    source,
    /^(?:var|const) preparedHeaderRoutes = configuredHeaderRoutes\.map\(function\s*\(route\)\s*\{[\s\S]*?^\}\);/gm,
    "",
  );
  baseline = replaceOnce(
    baseline,
    /^function applyConfiguredResponseHeaders\(response,\s*pathname\)\s*\{[\s\S]*?^\}/gm,
    (original) => {
      let fn = replaceOnce(
        original,
        /^[\t ]*if \(preparedHeaderRoutes.length === 0\) return response;\n/gm,
        "",
      );
      fn = replaceOnce(
        fn,
        /^[\t ]*const pathnameSegments = splitRuntimePath\(pathname\).map\(decodeRouteSegment\);\n/gm,
        "",
      );
      fn = replaceOnce(fn, /of preparedHeaderRoutes\)/g, "of configuredHeaderRoutes)");
      const preparedMatch = fn.includes("const matched = headerRoute.prepared")
        ? /^[\t ]*const matched = headerRoute.prepared[\s\S]*?if \(!matched\) continue;/gm
        : /^[\t ]*if \(!\(headerRoute.prepared[^\n]*\)\) continue;/gm;
      fn = replaceOnce(
        fn,
        preparedMatch,
        "  if (!matchRuntimePathPattern(headerRoute.source, pathname)) continue;",
      );
      assert.ok(!/preparedHeaderRoutes|pathnameSegments/.test(fn));
      return fn;
    },
  );
  assert.ok(!baseline.includes("preparedHeaderRoutes"));
  return baseline;
}

export function summarizePairs(pairs) {
  const median = (values) => {
    const sorted = values.toSorted((a, b) => a - b),
      middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const means = Object.fromEntries(
    ["baseline", "candidate", "controlA", "controlB"].map((arm) => [
      arm,
      median(pairs.map((pair) => pair[arm].meanUs)),
    ]),
  );
  return {
    medianProcessMeanUs: means,
    pairedChangePercent: pairs.map(
      (pair) => 100 * (pair.candidate.meanUs / pair.baseline.meanUs - 1),
    ),
    sameCodeControlChangePercent: pairs.map(
      (pair) => 100 * (pair.controlB.meanUs / pair.controlA.meanUs - 1),
    ),
  };
}
