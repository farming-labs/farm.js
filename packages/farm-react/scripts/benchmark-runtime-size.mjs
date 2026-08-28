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

const [directOff, directOn, keyedOff, keyedOn, runtimeControl, runtimeCore, runtimeFull] =
  await Promise.all([
    bundle("direct.tsx", false),
    bundle("direct.tsx", true),
    bundle("keyed.tsx", false),
    bundle("keyed.tsx", true),
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
