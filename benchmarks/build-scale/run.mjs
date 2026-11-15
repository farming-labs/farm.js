// `farm build` times on the dev-scale docs workspace: cold, warm with no change, and warm after
// editing one MDX page and one component (see README.md). Build @farm.js/core and @farm.js/cli in
// every checkout passed with --farm first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { createDevScaleFixture, MARKER } from "../dev-scale/fixture.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values: args } = parseArgs({
  options: {
    // Checkouts to compare, as label=path (or a path). Repeat a path under two labels for an A/A
    // control. Every round runs each variant once, alternating their order.
    farm: { type: "string", multiple: true, default: [`current=${repo}`] },
    mdx: { type: "string", default: "800" },
    tsx: { type: "string", default: "200" },
    primitives: { type: "string", default: "60" },
    samples: { type: "string", default: "5" },
    // Prerender every page (`dynamic = "force-static"`), as a docs site does.
    static: { type: "boolean", default: true },
    // Also build the edited sources cold and require the same output as the warm build.
    verify: { type: "boolean", default: false },
    out: { type: "string" },
    keep: { type: "boolean", default: false },
  },
  allowNegative: true,
});
const samples = Number(args.samples);
assert.ok(Number.isInteger(samples) && samples >= 1, "--samples must be an integer >= 1");

const variants = args.farm.map((entry, index) => {
  const [label, farmRepo] = entry.includes("=") ? entry.split("=", 2) : [`v${index}`, entry];
  const resolved = path.resolve(farmRepo);
  for (const built of ["packages/farm/dist/index.mjs", "packages/farm-cli/dist"]) {
    assert.ok(fs.existsSync(path.join(resolved, built)), `Build ${built} in ${resolved} first`);
  }
  return { label, farmRepo: resolved };
});

/**
 * Log lines that start each phase of `farm build`. A phase runs from its line to the next one
 * found; a phase whose line is missing (no prerendered pages) is left out.
 */
const PHASES = [
  ["startup", /^/],
  ["discovery", /Discovering routes and API endpoints/],
  ["hydrationPlanning", /Building (?:client and SSR bundles|application bundles)/],
  ["viteBundles", /building client environment for production/],
  // From the later of the client and SSR bundles to finish.
  ["postBundle", /✓ built in /, { last: true }],
  ["nitroSetup", /Building server with Nitro/],
  ["prerender", /Pre-rendering \d+ SSG page/],
  ["nitroBundle", /\[nitro\] Prerendered \d+ routes|Building server \(builder/],
  ["done", /Build completed successfully/],
];

function phasesOf(lines) {
  const marks = [];
  let from = 0;
  for (const [name, pattern, { last = false } = {}] of PHASES) {
    let index = lines.findIndex((line, i) => i >= from && pattern.test(line.text));
    if (index < 0) continue;
    if (last) index = lines.findLastIndex((line) => pattern.test(line.text));
    marks.push({ name, ms: name === "startup" ? 0 : lines[index].ms });
    from = index;
  }
  const phases = {};
  for (let i = 0; i < marks.length - 1; i++) phases[marks[i].name] = marks[i + 1].ms - marks[i].ms;
  return phases;
}

// Preloaded into each build's Node processes: appends the process's CPU time (every thread, so
// Rolldown's and the prerender worker's too) when it exits.
const rusageDir = fs.mkdtempSync(path.join(os.tmpdir(), "farm-build-scale-rusage-"));
const rusagePreload = path.join(rusageDir, "preload.mjs");
fs.writeFileSync(
  rusagePreload,
  `import fs from "node:fs";
process.on("exit", () => {
  const file = process.env.FARM_BUILD_SCALE_RUSAGE;
  if (!file) return;
  const { userCPUTime, systemCPUTime } = process.resourceUsage();
  fs.appendFileSync(file, (userCPUTime + systemCPUTime) / 1000 + "\\n");
});
`,
);
let buildCount = 0;

function build(app, variant) {
  return new Promise((resolve, reject) => {
    const rusageFile = path.join(rusageDir, `build-${++buildCount}.txt`);
    const started = performance.now();
    const child = spawn(
      process.execPath,
      [
        path.join(variant.farmRepo, "packages/farm-cli/bin/farm.js"),
        "build",
        "--preset",
        "node-server",
      ],
      {
        cwd: app,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          CI: "1",
          FARM_TELEMETRY_DISABLED: "1",
          NO_COLOR: "1",
          FARM_BUILD_SCALE_RUSAGE: rusageFile,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(rusagePreload).href}`,
        },
      },
    );
    const lines = [];
    const output = [];
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream.on("data", (chunk) => {
        const ms = performance.now() - started;
        output.push(String(chunk));
        const parts = (pending + chunk).split("\n");
        pending = parts.pop();
        for (const text of parts) lines.push({ ms, text });
      });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const ms = performance.now() - started;
      if (code !== 0) {
        reject(
          new Error(`farm build failed (${code ?? signal}):\n${output.join("").slice(-6000)}`),
        );
        return;
      }
      const cpuMs = fs
        .readFileSync(rusageFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .reduce((total, value) => total + Number(value), 0);
      resolve({ ms, cpuMs, phases: phasesOf(lines) });
    });
  });
}

/**
 * Digests of the deployable output. Builds are deterministic except for what both digests
 * normalize: the build id (`build-<Date.now()>`, unless the app sets `generateBuildId`), the
 * islands action key (random per build unless `ISLX_ACTIONS_KEY` is set), the date in nitro.json,
 * the order of Nitro's public asset table and the mtime, etag and compressed size it records for
 * each file, and the random temporary directory of the client entry. Compressed copies are
 * compared by their content.
 *
 * `portable` compares two checkouts: it also replaces the checkout's path (the server names
 * Farm's own modules by it) and drops the content hash from server chunk names, since a chunk of
 * an installed package is named by its module ids, which are paths into the checkout's own
 * `node_modules`. The chunks' content is still compared.
 */
const NITRO_ASSET_ENTRY = /\t"\/[^"\n]*": \{\n[^}]*\n\t\}/g;
const SERVER_CHUNK_HASH = /((?:assets\/|\.\/)[\w.-]+?)-[\w-]{8}\.js/g;

function outputDigests(app, farmRepo) {
  const portableText = (text) =>
    text
      .replaceAll(farmRepo.replace(/\\/g, "/"), "<farm>")
      .replace(SERVER_CHUNK_HASH, "$1-HASH.js");
  const root = path.join(app, ".farm/.output");
  const strict = crypto.createHash("sha256");
  const portable = [];
  const paths = fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)).replace(/\\/g, "/"),
    )
    .sort();
  for (const file of paths) {
    let contents = fs.readFileSync(path.join(root, file));
    if (file.endsWith(".gz")) contents = zlib.gunzipSync(contents);
    else if (file.endsWith(".br")) contents = zlib.brotliDecompressSync(contents);
    let text = contents
      .toString("latin1")
      .replace(/build-\d{13}/g, "build-ID")
      .replace(/(setBuildDefaults\(\{\s*key:\s*)(["'`])[\w-]+\2/g, "$1KEY")
      .replace(/(mtime: )(["'`])[\dT:.Z-]+\2/g, "$1MTIME")
      .replace(/client-entry-[A-Za-z0-9]{6}/g, "client-entry-X");
    if (file === "nitro.json") text = text.replace(/"date": "[^"]+"/, '"date": "DATE"');
    if (file.startsWith("server/") && file.endsWith(".mjs")) {
      // Nitro writes its public asset table in the order its directory scan finished, with each
      // file's mtime and an etag of its content (the content itself is compared), and the size of
      // a compressed copy, which the build id changes.
      text = text.replace(/(etag: )`"[^"`]+"`/g, "$1ETAG");
      const assets = text.match(NITRO_ASSET_ENTRY);
      if (assets && assets.length > 1) {
        const sorted = assets
          .map((entry) =>
            entry.includes("encoding:") ? entry.replace(/size: [\d.e]+/, "size: N") : entry,
          )
          .sort();
        let index = 0;
        text = text.replace(NITRO_ASSET_ENTRY, () => sorted[index++]);
      }
    }
    strict.update(`${file}\0${text.length}\0`).update(text, "latin1");
    portable.push([
      file.replace(SERVER_CHUNK_HASH, "$1-HASH.js"),
      crypto.createHash("sha256").update(portableText(text)).digest("hex"),
    ]);
  }
  const portableHash = crypto.createHash("sha256");
  portable.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  for (const [file, digest] of portable) portableHash.update(`${file}\0${digest}\0`);
  return {
    strict: strict.digest("hex").slice(0, 16),
    portable: portableHash.digest("hex").slice(0, 16),
  };
}

function removeCaches(app) {
  for (const dir of [".farm", "node_modules/.vite"]) {
    fs.rmSync(path.join(app, dir), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  }
}

/** Points the app's `@farm.js/core` and `@farm.js/cli` at a checkout. */
function useVariant(app, variant) {
  for (const [name, dir] of [
    ["@farm.js/core", "packages/farm"],
    ["@farm.js/cli", "packages/farm-cli"],
  ]) {
    const linkPath = path.join(app, "node_modules", name);
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.symlinkSync(path.join(variant.farmRepo, dir), linkPath, "junction");
  }
}

/** Sets the version text of the edited MDX page and workspace component to `version`. */
function setSources(fixture, version) {
  for (const [file, label] of [
    [path.join(fixture.app, `src/app${fixture.mdx[0]}/page.mdx`), "mdx body"],
    [path.join(fixture.ui, "src/callout.tsx"), "callout text"],
  ]) {
    const source = fs.readFileSync(file, "utf8");
    const next = source.replace(new RegExp(`${label} v\\d+`), `${label} v${version}`);
    if (next !== source) fs.writeFileSync(file, next);
    // The output depends on source mtimes too (a page's sitemap `lastmod`), so each version of
    // a file gets one mtime, whichever variant wrote it.
    const mtime = new Date(Date.UTC(2026, 0, 1) + version * 1000);
    fs.utimesSync(file, mtime, mtime);
  }
}

function assertBuilt(fixture, version) {
  let output;
  if (args.static) {
    output = fs.readFileSync(
      path.join(fixture.app, `.farm/.output/public${fixture.mdx[0]}/index.html`),
      "utf8",
    );
    assert.ok(output.includes(`data-marker="${MARKER}"`), "the layout did not render");
  } else {
    // Rendered per request: the server bundle carries the page source and the component.
    const server = path.join(fixture.app, ".farm/.output/server");
    output = fs
      .readdirSync(server, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name))
      .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
      .join("\n");
  }
  assert.ok(output.includes(`mdx body v${version}`), `the page does not show version ${version}`);
  assert.ok(output.includes(`callout text v${version}`), `the component does not show ${version}`);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// One workspace for every variant, so output that names its absolute paths stays comparable.
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-build-scale-")));
const fixture = createDevScaleFixture(workspace, {
  farmRepo: variants[0].farmRepo,
  mdxPages: Number(args.mdx),
  tsxPages: Number(args.tsx),
  primitives: Number(args.primitives),
  staticPages: args.static,
});
const STEPS = ["cold", "warm", "warmEdit"];
const results = Object.fromEntries(
  variants.map(({ label }) => [label, { ms: {}, cpuMs: {}, phases: {}, digests: [] }]),
);
const mismatches = [];
try {
  for (let round = 0; round < samples; round++) {
    const order = round % 2 ? [...variants].reverse() : variants;
    const roundDigests = {};
    for (const variant of order) {
      const result = results[variant.label];
      useVariant(fixture.app, variant);
      // Every variant starts the round from the same sources and no caches.
      setSources(fixture, 2 * round);
      removeCaches(fixture.app);
      const digests = {};
      for (const step of STEPS) {
        if (step === "warmEdit") setSources(fixture, 2 * round + 1);
        const { ms, cpuMs, phases } = await build(fixture.app, variant);
        assertBuilt(fixture, step === "warmEdit" ? 2 * round + 1 : 2 * round);
        (result.ms[step] ??= []).push(ms);
        (result.cpuMs[step] ??= []).push(cpuMs);
        for (const [phase, value] of Object.entries(phases)) {
          ((result.phases[step] ??= {})[phase] ??= []).push(value);
        }
        digests[step] = outputDigests(fixture.app, variant.farmRepo);
      }
      if (digests.cold.strict !== digests.warm.strict) {
        mismatches.push(`${variant.label} round ${round}: warm output differs from cold`);
      }
      if (args.verify) {
        removeCaches(fixture.app);
        await build(fixture.app, variant);
        digests.coldEdit = outputDigests(fixture.app, variant.farmRepo);
        if (digests.coldEdit.strict !== digests.warmEdit.strict) {
          mismatches.push(`${variant.label} round ${round}: warm edit output differs from cold`);
        }
      }
      result.digests.push(digests);
      roundDigests[variant.label] = digests;
      process.stderr.write(
        `round ${round + 1}/${samples} ${variant.label}: ${STEPS.map((step) => `${step} ${Math.round(result.ms[step].at(-1))}ms`).join(", ")}\n`,
      );
    }
    // Every checkout must write the same output for the same sources.
    const [[firstLabel, firstDigests], ...rest] = Object.entries(roundDigests);
    for (const [label, digests] of rest) {
      for (const step of Object.keys(digests)) {
        if (digests[step].portable !== firstDigests[step].portable) {
          mismatches.push(`round ${round} ${step}: ${label} output differs from ${firstLabel}`);
        }
      }
    }
  }
} finally {
  if (args.keep) process.stderr.write(`workspace kept at ${workspace}\n`);
  else fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  fs.rmSync(rusageDir, { recursive: true, force: true });
}

const round0 = (value) => Math.round(value);
const medians = (byStep) =>
  Object.fromEntries(STEPS.map((step) => [step, round0(median(byStep[step]))]));
const report = {
  benchmark: "build-scale",
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpus: os.availableParallelism(),
  mdxPages: Number(args.mdx),
  tsxPages: Number(args.tsx),
  static: args.static,
  samples,
  mismatches,
  variants: Object.fromEntries(
    Object.entries(results).map(([label, result]) => [
      label,
      {
        medianMs: medians(result.ms),
        medianCpuMs: medians(result.cpuMs),
        medianPhasesMs: Object.fromEntries(
          Object.entries(result.phases).map(([step, phases]) => [
            step,
            Object.fromEntries(
              Object.entries(phases).map(([phase, values]) => [phase, round0(median(values))]),
            ),
          ]),
        ),
        samplesMs: Object.fromEntries(STEPS.map((step) => [step, result.ms[step].map(round0)])),
        samplesCpuMs: Object.fromEntries(
          STEPS.map((step) => [step, result.cpuMs[step].map(round0)]),
        ),
        digests: result.digests,
      },
    ]),
  ),
};
for (const [label, result] of Object.entries(report.variants)) {
  const columns = STEPS.map(
    (step) => `${step} ${result.medianMs[step]} ms (cpu ${result.medianCpuMs[step]})`,
  );
  process.stderr.write(`${label.padEnd(14)} ${columns.join("  ")}\n`);
}
for (const mismatch of mismatches) process.stderr.write(`MISMATCH ${mismatch}\n`);
const json = JSON.stringify(report, null, 2);
if (args.out) fs.writeFileSync(args.out, `${json}\n`);
console.log(json);
if (mismatches.length > 0) process.exitCode = 1;
