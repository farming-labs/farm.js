import { brotliCompressSync, gzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { createFarmRendererPlugin } from "../dist/vite.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(packageRoot, "fixtures/runtime-size");
const resultFile = join(packageRoot, "RUNTIME_SIZE_RESULTS.json");
const checkOnly = process.argv.includes("--check");

async function bundle(entry, compiler) {
  const result = await build({
    configFile: false,
    root: fixtureRoot,
    logLevel: "silent",
    css: {
      postcss: { plugins: [] },
    },
    plugins: createFarmRendererPlugin({
      rendererOptions: {
        experimental: {
          compiler: compiler ? { onUnsupported: "error" } : false,
        },
      },
    }),
    build: {
      write: false,
      minify: "esbuild",
      rollupOptions: {
        input: join(fixtureRoot, entry),
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const code = outputs
    .flatMap((output) => output.output)
    .filter((output) => output.type === "chunk")
    .map((output) => output.code)
    .join("\n");
  const bytes = Buffer.from(code);
  return {
    code,
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes).length,
  };
}

const [
  directOff,
  directOn,
  keyedOff,
  keyedOn,
  keyedAppendOff,
  keyedAppendOn,
  keyedFilterOff,
  keyedFilterOn,
  keyedPrependOff,
  keyedPrependOn,
  keyedRollingWindowOff,
  keyedRollingWindowOn,
  keyedSliceOff,
  keyedSliceOn,
  runtimeControl,
  runtimeCore,
  runtimeFull,
] = await Promise.all([
  bundle("direct.tsx", false),
  bundle("direct.tsx", true),
  bundle("keyed.tsx", false),
  bundle("keyed.tsx", true),
  bundle("keyed-append.tsx", false),
  bundle("keyed-append.tsx", true),
  bundle("keyed-filter.tsx", false),
  bundle("keyed-filter.tsx", true),
  bundle("keyed-prepend.tsx", false),
  bundle("keyed-prepend.tsx", true),
  bundle("keyed-rolling-window.tsx", false),
  bundle("keyed-rolling-window.tsx", true),
  bundle("keyed-slice.tsx", false),
  bundle("keyed-slice.tsx", true),
  bundle("runtime-control.tsx", false),
  bundle("runtime-core.tsx", false),
  bundle("runtime-full.tsx", false),
]);

const forbiddenDirectMarkers = [
  "FarmCompiledConditionalBlock",
  "FarmCompiledHostConditionalBlock",
  "FarmCompiledKeyedListBlock",
  "FarmCompiledKeyedRows",
  "FarmCompiledKeyedRangesBlock",
  "FarmCompiledMixedRangesBlock",
  "FarmCompiledComponentBlock",
  '"set-add"',
  '"map-set"',
];
for (const marker of forbiddenDirectMarkers) {
  if (directOn.code.includes(marker) || runtimeCore.code.includes(marker)) {
    throw new Error(`Direct-only runtime unexpectedly retained ${marker}.`);
  }
}
if (!keyedOn.code.includes("FarmCompiledKeyedRows")) {
  throw new Error("Keyed fixture did not retain its keyed-row runtime.");
}
if (keyedOn.code.includes("FarmCompiledKeyedRowConditional")) {
  throw new Error("Plain keyed fixture retained the optional row-conditional runtime.");
}
if (keyedOn.code.includes("keyed-rows:hinted")) {
  throw new Error("Plain keyed fixture retained the optional keyed-update hint runtime.");
}
if (!keyedOn.code.includes("identityTarget")) {
  throw new Error("Keyed selection fixture did not retain its key-directed binding target.");
}
if (!keyedOn.code.includes("membershipTarget")) {
  throw new Error("Keyed selection fixture did not retain its Set-membership binding target.");
}
if (!keyedOn.code.includes("mapLookupTarget")) {
  throw new Error("Keyed selection fixture did not retain its Map-lookup binding target.");
}
if (!keyedOn.code.includes('"set-add"') || !keyedOn.code.includes('"map-set"')) {
  throw new Error("Keyed selection fixture did not retain its Set/Map collection-delta helpers.");
}
if (
  !keyedAppendOn.code.includes("FarmCompiledKeyedRows") ||
  !keyedAppendOn.code.includes("keyed-rows:hinted")
) {
  throw new Error("Keyed append fixture did not retain its optional hinted runtime.");
}
if (
  !keyedFilterOn.code.includes("FarmCompiledKeyedRows") ||
  !keyedFilterOn.code.includes("keyed-rows:filter-hinted") ||
  !keyedFilterOn.code.includes("filterIndexIndependent")
) {
  throw new Error("Keyed filter fixture did not retain its optional filter-hint runtime.");
}
if (
  !keyedPrependOn.code.includes("FarmCompiledKeyedRows") ||
  !keyedPrependOn.code.includes("keyed-rows:prepend-hinted") ||
  !keyedPrependOn.code.includes("prependIndexIndependent")
) {
  throw new Error("Keyed prepend fixture did not retain its optional prepend-hint runtime.");
}
if (
  !keyedSliceOn.code.includes("FarmCompiledKeyedRows") ||
  !keyedSliceOn.code.includes("keyed-rows:filter-hinted") ||
  !keyedSliceOn.code.includes("filterIndexIndependent")
) {
  throw new Error("Keyed slice fixture did not retain its optional removal-hint runtime.");
}
if (
  !keyedRollingWindowOn.code.includes("FarmCompiledKeyedRows") ||
  !keyedRollingWindowOn.code.includes("keyed-rows:all-hinted") ||
  !keyedRollingWindowOn.code.includes("filterIndexIndependent")
) {
  throw new Error("Keyed rolling-window fixture did not retain its isolated all-hint runtime.");
}
for (const [name, output] of [
  ["direct", directOn],
  ["plain keyed", keyedOn],
  ["append-only", keyedAppendOn],
  ["filter-only", keyedFilterOn],
  ["slice-only", keyedSliceOn],
]) {
  if (
    output.code.includes("prependIndexIndependent") ||
    output.code.includes("keyed-rows:prepend-hinted") ||
    output.code.includes("keyed-rows:filter-prepend-hinted")
  ) {
    throw new Error(`${name} fixture retained the optional prepend-hint runtime.`);
  }
  if (output.code.includes("keyed-rows:all-hinted")) {
    throw new Error(`${name} fixture retained the optional rolling-window runtime.`);
  }
}
if (keyedPrependOn.code.includes("filterIndexIndependent")) {
  throw new Error("Prepend-only fixture retained the optional filter-hint runtime.");
}
if (keyedSliceOn.code.includes("prependIndexIndependent")) {
  throw new Error("Slice-only fixture retained the optional prepend-hint runtime.");
}

const fullRuntimePremium = runtimeFull.gzip - runtimeControl.gzip;
const coreRuntimePremium = runtimeCore.gzip - runtimeControl.gzip;
const runtimeReduction = 1 - coreRuntimePremium / fullRuntimePremium;
if (runtimeReduction < 0.5) {
  throw new Error(
    `Core runtime gzip reduction was ${(runtimeReduction * 100).toFixed(1)}%; expected at least 50%.`,
  );
}

const results = {
  version: 1,
  compression: "gzip level 9 and Node Brotli defaults",
  fixtures: {
    direct: {
      compilerOff: { raw: directOff.raw, gzip: directOff.gzip, brotli: directOff.brotli },
      compilerOn: { raw: directOn.raw, gzip: directOn.gzip, brotli: directOn.brotli },
      compilerPremium: {
        raw: directOn.raw - directOff.raw,
        gzip: directOn.gzip - directOff.gzip,
        brotli: directOn.brotli - directOff.brotli,
      },
    },
    keyed: {
      compilerOff: { raw: keyedOff.raw, gzip: keyedOff.gzip, brotli: keyedOff.brotli },
      compilerOn: { raw: keyedOn.raw, gzip: keyedOn.gzip, brotli: keyedOn.brotli },
      compilerPremium: {
        raw: keyedOn.raw - keyedOff.raw,
        gzip: keyedOn.gzip - keyedOff.gzip,
        brotli: keyedOn.brotli - keyedOff.brotli,
      },
    },
    keyedAppend: {
      compilerOff: {
        raw: keyedAppendOff.raw,
        gzip: keyedAppendOff.gzip,
        brotli: keyedAppendOff.brotli,
      },
      compilerOn: {
        raw: keyedAppendOn.raw,
        gzip: keyedAppendOn.gzip,
        brotli: keyedAppendOn.brotli,
      },
      compilerPremium: {
        raw: keyedAppendOn.raw - keyedAppendOff.raw,
        gzip: keyedAppendOn.gzip - keyedAppendOff.gzip,
        brotli: keyedAppendOn.brotli - keyedAppendOff.brotli,
      },
    },
    keyedFilter: {
      compilerOff: {
        raw: keyedFilterOff.raw,
        gzip: keyedFilterOff.gzip,
        brotli: keyedFilterOff.brotli,
      },
      compilerOn: {
        raw: keyedFilterOn.raw,
        gzip: keyedFilterOn.gzip,
        brotli: keyedFilterOn.brotli,
      },
      compilerPremium: {
        raw: keyedFilterOn.raw - keyedFilterOff.raw,
        gzip: keyedFilterOn.gzip - keyedFilterOff.gzip,
        brotli: keyedFilterOn.brotli - keyedFilterOff.brotli,
      },
    },
    keyedPrepend: {
      compilerOff: {
        raw: keyedPrependOff.raw,
        gzip: keyedPrependOff.gzip,
        brotli: keyedPrependOff.brotli,
      },
      compilerOn: {
        raw: keyedPrependOn.raw,
        gzip: keyedPrependOn.gzip,
        brotli: keyedPrependOn.brotli,
      },
      compilerPremium: {
        raw: keyedPrependOn.raw - keyedPrependOff.raw,
        gzip: keyedPrependOn.gzip - keyedPrependOff.gzip,
        brotli: keyedPrependOn.brotli - keyedPrependOff.brotli,
      },
    },
    keyedSlice: {
      compilerOff: {
        raw: keyedSliceOff.raw,
        gzip: keyedSliceOff.gzip,
        brotli: keyedSliceOff.brotli,
      },
      compilerOn: {
        raw: keyedSliceOn.raw,
        gzip: keyedSliceOn.gzip,
        brotli: keyedSliceOn.brotli,
      },
      compilerPremium: {
        raw: keyedSliceOn.raw - keyedSliceOff.raw,
        gzip: keyedSliceOn.gzip - keyedSliceOff.gzip,
        brotli: keyedSliceOn.brotli - keyedSliceOff.brotli,
      },
    },
    keyedRollingWindow: {
      compilerOff: {
        raw: keyedRollingWindowOff.raw,
        gzip: keyedRollingWindowOff.gzip,
        brotli: keyedRollingWindowOff.brotli,
      },
      compilerOn: {
        raw: keyedRollingWindowOn.raw,
        gzip: keyedRollingWindowOn.gzip,
        brotli: keyedRollingWindowOn.brotli,
      },
      compilerPremium: {
        raw: keyedRollingWindowOn.raw - keyedRollingWindowOff.raw,
        gzip: keyedRollingWindowOn.gzip - keyedRollingWindowOff.gzip,
        brotli: keyedRollingWindowOn.brotli - keyedRollingWindowOff.brotli,
      },
    },
    isolatedRuntime: {
      control: {
        raw: runtimeControl.raw,
        gzip: runtimeControl.gzip,
        brotli: runtimeControl.brotli,
      },
      full: { raw: runtimeFull.raw, gzip: runtimeFull.gzip, brotli: runtimeFull.brotli },
      coreOnly: { raw: runtimeCore.raw, gzip: runtimeCore.gzip, brotli: runtimeCore.brotli },
      fullRuntimePremiumGzip: fullRuntimePremium,
      coreRuntimePremiumGzip: coreRuntimePremium,
      gzipReductionPercent: Number((runtimeReduction * 100).toFixed(1)),
    },
  },
};

if (checkOnly) {
  const reference = JSON.parse(await readFile(resultFile, "utf8"));
  const checks = [
    {
      name: "direct compiler premium",
      current: results.fixtures.direct.compilerPremium.gzip,
      maximum: reference.fixtures.direct.compilerPremium.gzip + 128,
    },
    {
      name: "keyed compiler premium",
      current: results.fixtures.keyed.compilerPremium.gzip,
      maximum: reference.fixtures.keyed.compilerPremium.gzip + 256,
    },
    {
      name: "keyed append compiler premium",
      current: results.fixtures.keyedAppend.compilerPremium.gzip,
      maximum: reference.fixtures.keyedAppend.compilerPremium.gzip + 256,
    },
    {
      name: "keyed filter compiler premium",
      current: results.fixtures.keyedFilter.compilerPremium.gzip,
      maximum: (reference.fixtures.keyedFilter?.compilerPremium.gzip ?? 12_000) + 256,
    },
    {
      name: "keyed prepend compiler premium",
      current: results.fixtures.keyedPrepend.compilerPremium.gzip,
      maximum: (reference.fixtures.keyedPrepend?.compilerPremium.gzip ?? 12_000) + 256,
    },
    {
      name: "keyed slice compiler premium",
      current: results.fixtures.keyedSlice.compilerPremium.gzip,
      maximum: (reference.fixtures.keyedSlice?.compilerPremium.gzip ?? 12_250) + 256,
    },
    {
      name: "keyed rolling-window compiler premium",
      current: results.fixtures.keyedRollingWindow.compilerPremium.gzip,
      maximum:
        (reference.fixtures.keyedRollingWindow?.compilerPremium.gzip ??
          results.fixtures.keyedRollingWindow.compilerPremium.gzip) + 256,
    },
    {
      name: "core runtime premium",
      current: results.fixtures.isolatedRuntime.coreRuntimePremiumGzip,
      maximum: reference.fixtures.isolatedRuntime.coreRuntimePremiumGzip + 128,
    },
  ];
  for (const check of checks) {
    if (check.current > check.maximum) {
      throw new Error(
        `${check.name} grew to ${check.current} B gzip; persisted maximum is ${check.maximum} B.`,
      );
    }
  }
  if (
    results.fixtures.isolatedRuntime.gzipReductionPercent <
    reference.fixtures.isolatedRuntime.gzipReductionPercent - 1
  ) {
    throw new Error("Core-only runtime reduction regressed against the persisted result.");
  }
} else {
  await writeFile(resultFile, `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(results, null, 2));
