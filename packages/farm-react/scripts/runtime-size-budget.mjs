// Preserve the existing gzip allowances. Bound Brotli independently by the
// same byte allowances, and require an explicit policy for every new fixture.
const COMPILER_PREMIUM_ALLOWANCES = {
  direct: 128,
  keyed: 256,
  keyedPlain: 256,
  keyedAppend: 256,
  keyedFilter: 264,
  keyedStructuralAppend: 256,
  keyedStructuralAppendMap: 256,
  keyedStructuralPrepend: 256,
  keyedStructuralPrependMap: 256,
  keyedPrepend: 256,
  keyedPosition: 256,
  keyedBatchPosition: 256,
  keyedWindowPosition: 256,
  keyedReorder: 256,
  keyedMapReorder: 328,
  keyedSort: 256,
  keyedSlice: 256,
  keyedRollingWindow: 256,
  keyedMappedRollingWindow: 256,
};

function finiteMetric(value, location) {
  if (!Number.isFinite(value)) {
    throw new Error(
      `Missing or invalid ${location}; expected a finite number. Record and review the fixture baseline before checking budgets.`,
    );
  }
  return value;
}

function assertPremium(current, reference, allowance, location, encoding) {
  const measured = finiteMetric(current, `current ${location}.${encoding}`);
  const maximum = finiteMetric(reference, `reference ${location}.${encoding}`) + allowance;
  if (measured > maximum) {
    throw new Error(
      `${location} grew to ${measured} B ${encoding}; persisted maximum is ${maximum} B.`,
    );
  }
}

/** Enforce every reported compiler premium without changing bundle generation. */
export function assertRuntimeSizeBudgets(current, reference) {
  for (const [side, report] of [
    ["current", current],
    ["reference", reference],
  ]) {
    for (const fixture of Object.keys(report?.fixtures ?? {})) {
      if (fixture !== "isolatedRuntime" && !Object.hasOwn(COMPILER_PREMIUM_ALLOWANCES, fixture)) {
        throw new Error(`Missing budget policy for ${side} fixture ${fixture}.`);
      }
    }
  }
  for (const [fixture, allowance] of Object.entries(COMPILER_PREMIUM_ALLOWANCES)) {
    for (const encoding of ["gzip", "brotli"]) {
      assertPremium(
        current?.fixtures?.[fixture]?.compilerPremium?.[encoding],
        reference?.fixtures?.[fixture]?.compilerPremium?.[encoding],
        allowance,
        `${fixture}.compilerPremium`,
        encoding,
      );
    }
  }
  const core = current?.fixtures?.isolatedRuntime;
  const coreReference = reference?.fixtures?.isolatedRuntime;
  assertPremium(
    core?.coreRuntimePremiumGzip,
    coreReference?.coreRuntimePremiumGzip,
    128,
    "isolatedRuntime.corePremium",
    "gzip",
  );
  const coreBrotliPremium = (fixture, side) =>
    finiteMetric(fixture?.coreOnly?.brotli, `${side} isolatedRuntime.coreOnly.brotli`) -
    finiteMetric(fixture?.control?.brotli, `${side} isolatedRuntime.control.brotli`);
  assertPremium(
    coreBrotliPremium(core, "current"),
    coreBrotliPremium(coreReference, "reference"),
    128,
    "isolatedRuntime.corePremium",
    "brotli",
  );
  assertCoreRuntimeReduction(core, coreReference);
}

/** Compare core size without penalizing a smaller full compatibility runtime. */
export function assertCoreRuntimeReduction(current, reference) {
  // The caller checks the absolute core-byte budget separately. Use the larger
  // control here: shrinking the full runtime alone must not count as core growth.
  const fullRuntimePremium = Math.max(
    finiteMetric(current?.fullRuntimePremiumGzip, "current isolatedRuntime.fullRuntimePremiumGzip"),
    finiteMetric(
      reference?.fullRuntimePremiumGzip,
      "reference isolatedRuntime.fullRuntimePremiumGzip",
    ),
  );
  const corePremium = finiteMetric(
    current?.coreRuntimePremiumGzip,
    "current isolatedRuntime.coreRuntimePremiumGzip",
  );
  finiteMetric(
    reference?.coreRuntimePremiumGzip,
    "reference isolatedRuntime.coreRuntimePremiumGzip",
  );
  const minimumReduction =
    finiteMetric(
      reference?.gzipReductionPercent,
      "reference isolatedRuntime.gzipReductionPercent",
    ) - 1;
  if (fullRuntimePremium <= 0)
    throw new Error("Core-only runtime reduction requires a positive full-runtime control.");
  const reduction = (1 - corePremium / fullRuntimePremium) * 100;
  if (reduction < minimumReduction) {
    throw new Error("Core-only runtime reduction regressed against the persisted result.");
  }
}
