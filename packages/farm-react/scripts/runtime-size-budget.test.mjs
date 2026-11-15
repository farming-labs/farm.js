import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertCoreRuntimeReduction, assertRuntimeSizeBudgets } from "./runtime-size-budget.mjs";

const reference = {
  coreRuntimePremiumGzip: 100,
  fullRuntimePremiumGzip: 1000,
  gzipReductionPercent: 90,
};

test("a smaller full runtime does not falsely report core growth", () => {
  assert.doesNotThrow(() =>
    assertCoreRuntimeReduction(
      { coreRuntimePremiumGzip: 100, fullRuntimePremiumGzip: 500 },
      reference,
    ),
  );
});

test("core growth remains bounded when the full runtime shrinks", () => {
  assert.throws(() =>
    assertCoreRuntimeReduction(
      { coreRuntimePremiumGzip: 120, fullRuntimePremiumGzip: 500 },
      reference,
    ),
  );
});

test("the current full runtime remains the control when it grows", () => {
  assert.doesNotThrow(() =>
    assertCoreRuntimeReduction(
      { coreRuntimePremiumGzip: 200, fullRuntimePremiumGzip: 2000 },
      reference,
    ),
  );
  assert.throws(() =>
    assertCoreRuntimeReduction(
      { coreRuntimePremiumGzip: 230, fullRuntimePremiumGzip: 2000 },
      reference,
    ),
  );
});

const fixtureReference = JSON.parse(
  readFileSync(new URL("../RUNTIME_SIZE_RESULTS.json", import.meta.url), "utf8"),
);

function addPremium(report, fixture, encoding, bytes) {
  const entry = report.fixtures[fixture];
  if (fixture !== "isolatedRuntime") entry.compilerPremium[encoding] += bytes;
  else if (encoding === "gzip") entry.coreRuntimePremiumGzip += bytes;
  else entry.coreOnly.brotli += bytes;
}

test("unchanged and smaller gzip/Brotli premiums pass without mutating the reports", () => {
  const current = structuredClone(fixtureReference);
  const referenceCopy = structuredClone(fixtureReference);
  assert.doesNotThrow(() => assertRuntimeSizeBudgets(current, referenceCopy));
  assert.deepEqual(current, fixtureReference);
  assert.deepEqual(referenceCopy, fixtureReference);
  for (const fixture of Object.keys(current.fixtures)) {
    for (const encoding of ["gzip", "brotli"]) addPremium(current, fixture, encoding, -100);
  }
  assert.doesNotThrow(() => assertRuntimeSizeBudgets(current, referenceCopy));
});

for (const fixture of Object.keys(fixtureReference.fixtures)) {
  for (const encoding of ["gzip", "brotli"]) {
    test(`${fixture} rejects an isolated ${encoding} regression`, () => {
      const current = structuredClone(fixtureReference);
      addPremium(current, fixture, encoding, 1_000_000);
      assert.throws(() => assertRuntimeSizeBudgets(current, fixtureReference), /grew/);
    });
  }
}

test("every measured fixture requires a persisted reference, including position hints", () => {
  for (const fixture of Object.keys(fixtureReference.fixtures)) {
    const referenceCopy = structuredClone(fixtureReference);
    delete referenceCopy.fixtures[fixture];
    assert.throws(
      () => assertRuntimeSizeBudgets(fixtureReference, referenceCopy),
      new RegExp(`reference.*${fixture}`),
    );
  }
});

test("missing current fixture results fail instead of silently dropping their checks", () => {
  for (const fixture of Object.keys(fixtureReference.fixtures)) {
    const current = structuredClone(fixtureReference);
    delete current.fixtures[fixture];
    assert.throws(
      () => assertRuntimeSizeBudgets(current, fixtureReference),
      new RegExp(`current.*${fixture}`),
    );
  }
});

test("new fixtures require an explicit budget policy", () => {
  for (const side of ["current", "reference"]) {
    const current = structuredClone(fixtureReference);
    const referenceCopy = structuredClone(fixtureReference);
    (side === "current" ? current : referenceCopy).fixtures.newFixture = current.fixtures.direct;
    assert.throws(() => assertRuntimeSizeBudgets(current, referenceCopy), /budget.*newFixture/);
  }
});

test("missing, nonnumeric and nonfinite metrics fail closed on both sides", () => {
  for (const value of [undefined, null, "100", NaN, Infinity, -Infinity]) {
    for (const encoding of ["gzip", "brotli"]) {
      for (const side of ["current", "reference"]) {
        const current = structuredClone(fixtureReference);
        const referenceCopy = structuredClone(fixtureReference);
        const target = side === "current" ? current : referenceCopy;
        target.fixtures.direct.compilerPremium[encoding] = value;
        assert.throws(
          () => assertRuntimeSizeBudgets(current, referenceCopy),
          new RegExp(`${side}.*direct.*${encoding}`),
        );
      }
    }
  }
});

test("isolated runtime Brotli premiums require both finite component measurements", () => {
  for (const value of [undefined, null, "100", NaN, Infinity, -Infinity]) {
    for (const field of ["coreOnly", "control"]) {
      for (const side of ["current", "reference"]) {
        const current = structuredClone(fixtureReference);
        const referenceCopy = structuredClone(fixtureReference);
        const target = side === "current" ? current : referenceCopy;
        target.fixtures.isolatedRuntime[field].brotli = value;
        assert.throws(
          () => assertRuntimeSizeBudgets(current, referenceCopy),
          new RegExp(`${side}.*isolatedRuntime.*${field}.*brotli`),
        );
      }
    }
  }
});

test("existing gzip tolerances are preserved and independently applied to Brotli", () => {
  const tolerances = {
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
    isolatedRuntime: 128,
  };
  assert.deepEqual(Object.keys(tolerances).sort(), Object.keys(fixtureReference.fixtures).sort());
  for (const [fixture, tolerance] of Object.entries(tolerances)) {
    for (const encoding of ["gzip", "brotli"]) {
      const current = structuredClone(fixtureReference);
      addPremium(current, fixture, encoding, tolerance);
      assert.doesNotThrow(() => assertRuntimeSizeBudgets(current, fixtureReference));
      addPremium(current, fixture, encoding, 1);
      assert.throws(() => assertRuntimeSizeBudgets(current, fixtureReference), /grew/);
    }
  }
});

test("a valid negative compiler premium is not mistaken for a missing measurement", () => {
  const current = structuredClone(fixtureReference);
  const referenceCopy = structuredClone(fixtureReference);
  for (const encoding of ["gzip", "brotli"]) {
    current.fixtures.direct.compilerPremium[encoding] = -200;
    referenceCopy.fixtures.direct.compilerPremium[encoding] = -100;
  }
  assert.doesNotThrow(() => assertRuntimeSizeBudgets(current, referenceCopy));
});

test("invalid core reduction metrics cannot disable the relative check", () => {
  for (const key of ["coreRuntimePremiumGzip", "fullRuntimePremiumGzip", "gzipReductionPercent"]) {
    for (const value of [undefined, null, "100", NaN, Infinity, -Infinity]) {
      assert.throws(() => assertCoreRuntimeReduction(reference, { ...reference, [key]: value }));
    }
  }
  for (const key of ["coreRuntimePremiumGzip", "fullRuntimePremiumGzip"]) {
    assert.throws(() => assertCoreRuntimeReduction({ ...reference, [key]: NaN }, reference));
  }
  assert.throws(
    () =>
      assertCoreRuntimeReduction(
        { ...reference, fullRuntimePremiumGzip: 0 },
        { ...reference, fullRuntimePremiumGzip: 0 },
      ),
    /positive full-runtime control/,
  );
});
