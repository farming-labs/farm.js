import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { createFarmRendererPlugin } from "../dist/vite.mjs";
import { measureJavaScriptOutput } from "./javascript-output-size.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/runtime-size");
const chunkAccounting = [];
async function bundle(kind, controlFeature) {
  let replaced = false;
  const result = await build({
    root,
    configFile: false,
    logLevel: "silent",
    css: { postcss: { plugins: [] } },
    plugins: [
      ...createFarmRendererPlugin({
        rendererOptions: { compiler: { onUnsupported: "error" } },
      }),
      {
        name: "full-target-runtime-control",
        enforce: "post",
        transform(code, id) {
          if (!controlFeature || !id.endsWith(`keyed-${kind}.tsx`)) return;
          const control = code.replace(
            /keyedRows(?:PlainMapReorderHinted|PlainReorderHinted|PrependOnly|FilterOnly|AppendOnly|IdentityFilterOnly|Identity|Membership|MapLookup)RuntimeFeature/g,
            () => {
              replaced = true;
              return controlFeature;
            },
          );
          return { code: control, map: null };
        },
      },
    ],
    build: {
      write: false,
      minify: "esbuild",
      rollupOptions: { input: join(root, `keyed-${kind}.tsx`) },
    },
  });
  if (controlFeature) assert.ok(replaced, "control must replace a specialized compiler feature");
  const measured = measureJavaScriptOutput(result);
  if (measured.chunkAccounting.files.length > 1) {
    chunkAccounting.push({
      kind,
      controlFeature: controlFeature ?? null,
      ...measured.chunkAccounting,
    });
  }
  return measured;
}

const results = [];
for (const kind of [
  "identity",
  "membership",
  "map-lookup",
  "identity-filter",
  "append",
  "prepend",
  "filter",
  "slice",
  "reorder",
  "sort",
  "map-reorder",
]) {
  const removalOnly = kind === "filter" || kind === "slice";
  const plainReorder = kind === "reorder" || kind === "sort";
  const plainMapReorder = kind === "map-reorder";
  const full = await bundle(
    kind,
    plainMapReorder
      ? "keyedRowsMapReorderHintedRuntimeFeature"
      : plainReorder
        ? "keyedRowsReorderHintedRuntimeFeature"
        : kind === "append"
          ? "keyedRowsHintedRuntimeFeature"
          : kind === "prepend"
            ? "keyedRowsPrependHintedRuntimeFeature"
            : kind === "identity-filter" || removalOnly
              ? "keyedRowsFilterHintedRuntimeFeature"
              : "keyedRowsRuntimeFeature",
  );
  const specialized = await bundle(kind);
  assert.ok(
    specialized.code.includes(
      `keyed-rows:${plainMapReorder ? "plain-map-reorder-hinted" : plainReorder ? "plain-reorder-hinted" : kind === "append" ? "append-only" : kind === "prepend" ? "prepend-only" : removalOnly ? "filter-only" : kind === "identity-filter" ? "identity-filter-only" : kind}`,
    ),
  );
  if (
    kind === "identity" ||
    kind === "append" ||
    kind === "prepend" ||
    removalOnly ||
    plainReorder ||
    plainMapReorder
  ) {
    for (const marker of ["Set.prototype.has", "Map.prototype.get"]) {
      assert.ok(full.code.includes(marker), `control must retain ${marker}`);
      assert.ok(!specialized.code.includes(marker), `${kind} runtime must not retain ${marker}`);
    }
  }
  assert.ok(specialized.gzip < full.gzip, `${kind} specialization must reduce gzip payload`);
  if (plainReorder || plainMapReorder) {
    assert.ok(
      full.code.includes(`keyed-rows:${plainMapReorder ? "map-reorder" : "reorder"}-hinted`),
    );
    const minimumSaving = plainMapReorder ? 1024 : 512;
    assert.ok(
      full.gzip - specialized.gzip >= minimumSaving,
      `${kind} specialization must save at least ${minimumSaving} B gzip`,
    );
    assert.ok(
      specialized.brotli < full.brotli,
      `${kind} specialization must reduce Brotli payload`,
    );
  }
  if (kind === "append") {
    assert.ok(full.code.includes("keyed-rows:hinted"));
    assert.ok(
      full.gzip - specialized.gzip >= 1024,
      "append-only runtime must save at least 1 KiB gzip",
    );
  }
  if (removalOnly || kind === "prepend") {
    assert.ok(full.code.includes(`keyed-rows:${kind === "prepend" ? "prepend" : "filter"}-hinted`));
    assert.ok(
      full.gzip - specialized.gzip >= 1024,
      `${kind}-only runtime must save at least 1 KiB gzip`,
    );
    assert.ok(specialized.brotli < full.brotli, `${kind}-only runtime must reduce Brotli payload`);
  }
  if (kind === "identity-filter") {
    assert.ok(full.code.includes("keyed-rows:filter-hinted"), "control must keep filter hints");
    assert.ok(
      full.gzip - specialized.gzip >= 512,
      "identity/filter specialization must save at least 512 B gzip",
    );
    const legacy = await bundle(kind, "keyedRowsIdentityFilterHintedRuntimeFeature");
    assert.ok(legacy.code.includes("keyed-rows:identity-filter-hinted"));
    assert.ok(
      legacy.gzip - specialized.gzip >= 512,
      "filter-only specialization must save at least 512 B gzip over the legacy identity/filter runtime",
    );
    results.push({
      kind: "identity-filter-only-vs-legacy",
      full: { raw: legacy.raw, gzip: legacy.gzip },
      specialized: { raw: specialized.raw, gzip: specialized.gzip },
      savedGzip: legacy.gzip - specialized.gzip,
    });
  }
  results.push({
    kind,
    full: { raw: full.raw, gzip: full.gzip, brotli: full.brotli },
    specialized: { raw: specialized.raw, gzip: specialized.gzip, brotli: specialized.brotli },
    savedGzip: full.gzip - specialized.gzip,
  });
}

// A combined table catches retained machinery that isolated operation fixtures can miss.
const table = await bundle("table");
const conditionalTable = await bundle("table", "keyedRowsConditionalFilterHintedRuntimeFeature");
assert.ok(table.code.includes("keyed-rows:identity-filter-only"));
assert.ok(conditionalTable.code.includes("FarmCompiledKeyedRowConditional"));
for (const marker of [
  "FarmCompiledKeyedRowConditional",
  "conditionalListeners",
  "pruneConditionalListeners",
]) {
  assert.ok(!table.code.includes(marker), `plain combined table must not retain ${marker}`);
}
assert.ok(table.gzip < conditionalTable.gzip, "plain table must omit conditional gzip payload");
assert.ok(
  table.brotli < conditionalTable.brotli,
  "plain table must omit conditional Brotli payload",
);
results.push({
  kind: "combined-table-conditional-ownership",
  full: { raw: conditionalTable.raw, gzip: conditionalTable.gzip, brotli: conditionalTable.brotli },
  specialized: { raw: table.raw, gzip: table.gzip, brotli: table.brotli },
  savedGzip: conditionalTable.gzip - table.gzip,
});
console.log(
  JSON.stringify(
    { node: process.version, results, ...(chunkAccounting.length > 0 ? { chunkAccounting } : {}) },
    null,
    2,
  ),
);
