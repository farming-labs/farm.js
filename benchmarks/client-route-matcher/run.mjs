// Client route matcher benchmark (see README.md): what building the production client's route
// matchers costs on the first navigation, cold and warm, at several route counts, for each
// checkout passed with --farm. Bundles each checkout's router from source; needs no build.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { clientRouteTable, PROBE_PATHS } from "./routes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const esbuild = createRequire(path.join(repo, "packages/farm/package.json"))("esbuild");

const { values: args } = parseArgs({
  options: {
    // Checkouts to compare, as label=path (or a path). Repeat a path under two labels for an A/A
    // control. Every round runs each variant once, rotating which goes first.
    farm: { type: "string", multiple: true, default: [`current=${repo}`] },
    routes: { type: "string", default: "100,1000,5000" },
    samples: { type: "string", default: "15" },
    out: { type: "string" },
  },
});
const samples = Number(args.samples);
assert.ok(Number.isInteger(samples) && samples >= 1, "--samples must be an integer >= 1");
const routeCounts = args.routes.split(",").map(Number);
assert.ok(
  routeCounts.every((count) => Number.isInteger(count) && count >= 20),
  "--routes >= 20",
);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-route-matcher-"));
const variants = await Promise.all(
  args.farm.map(async (entry, index) => {
    const [label, farmRepo] = entry.includes("=") ? entry.split("=", 2) : [`v${index}`, entry];
    const resolved = path.resolve(farmRepo);
    const source = path.join(resolved, "packages/farm/src/router.ts");
    assert.ok(fs.existsSync(source), `No router source in ${resolved}`);
    const bundle = path.join(work, `${index}-${label}.mjs`);
    await esbuild.build({
      entryPoints: [source],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: bundle,
      logLevel: "error",
    });
    // The router as the client entry ships it: minified for the browser.
    const minified = await esbuild.build({
      entryPoints: [source],
      bundle: true,
      format: "esm",
      platform: "browser",
      minify: true,
      write: false,
      logLevel: "error",
    });
    const code = minified.outputFiles[0].contents;
    let revision = null;
    try {
      revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: resolved })
        .toString()
        .trim();
    } catch {
      // Not a git checkout.
    }
    return {
      label,
      farmRepo: resolved,
      revision,
      bundle,
      routerBytes: {
        minified: code.length,
        gzip: zlib.gzipSync(code, { level: 9 }).length,
        brotli: zlib.brotliCompressSync(code).length,
      },
    };
  }),
);

// Correctness control: every variant must order the routes and match every probe path the
// same way before any timing counts.
const toRoute = (route) => ({ path: route.pattern, meta: route });
for (const count of routeCounts) {
  const table = clientRouteTable(count);
  const paths = [...PROBE_PATHS, ...table.slice(0, 200).map((route) => route.pattern)];
  let expected;
  for (const variant of variants) {
    const { createFarmRouter } = await import(pathToFileURL(variant.bundle).href);
    const router = createFarmRouter(table.map(toRoute));
    const result = {
      order: router.routes.map((route) => route.path),
      matches: paths.map((pathname) => {
        const match = router.match(pathname);
        return match && [match.route.path, match.pathname, match.params];
      }),
    };
    if (expected) assert.deepEqual(result, expected, `${variant.label} differs at ${count} routes`);
    expected ??= result;
  }
}

const results = Object.fromEntries(
  routeCounts.map((count) => [count, Object.fromEntries(variants.map((v) => [v.label, []]))]),
);
for (let round = 0; round < samples; round++) {
  for (const count of routeCounts) {
    for (let offset = 0; offset < variants.length; offset++) {
      const variant = variants[(round + offset) % variants.length];
      const child = spawnSync(
        process.execPath,
        [path.join(here, "measure.mjs"), pathToFileURL(variant.bundle).href, String(count)],
        { encoding: "utf8" },
      );
      assert.equal(child.status, 0, child.stderr);
      results[count][variant.label].push(JSON.parse(child.stdout));
    }
  }
  process.stderr.write(`round ${round + 1}/${samples}\n`);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const metrics = ["coldBuildMs", "coldFirstMatchMs", "warmBuildMs", "warmMatchMs"];
const summary = Object.fromEntries(
  routeCounts.map((count) => [
    count,
    Object.fromEntries(
      variants.map((variant) => [
        variant.label,
        Object.fromEntries(
          metrics.map((metric) => [
            metric,
            Number(
              median(results[count][variant.label].map((sample) => sample[metric])).toFixed(4),
            ),
          ]),
        ),
      ]),
    ),
  ]),
);

const report = {
  node: process.version,
  cpu: os.cpus()[0]?.model,
  samples,
  variants: variants.map(({ label, farmRepo, revision, routerBytes }) => ({
    label,
    farmRepo,
    revision,
    routerBytes,
  })),
  summary,
  results,
};
console.log(
  `Node ${report.node}, ${report.cpu}, ${samples} fresh processes per cell (medians, ms)`,
);
for (const variant of report.variants) {
  const { minified, gzip, brotli } = variant.routerBytes;
  console.log(
    `${variant.label}: router ${minified} B minified, ${gzip} B gzip, ${brotli} B brotli`,
  );
}
console.table(
  routeCounts.flatMap((count) =>
    variants.map((variant) => ({
      routes: count,
      variant: variant.label,
      ...summary[count][variant.label],
    })),
  ),
);
if (args.out) fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
fs.rmSync(work, { recursive: true, force: true });
