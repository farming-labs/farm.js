// Build core, CLI and React first. Node 24+ (registerHooks), no public cache flag.
// Runs real Farm builds sequentially; the baseline disables only build reuse.
// With BASE_REF=<ref>, keep reuse enabled and compare that revision's compiler
// source against the working-tree compiler, with all other build code fixed.
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cpus, loadavg, release, tmpdir } from "node:os";

if (process.env.FARM_CACHE_BENCH_CHILD) {
  // Load in both variants so diagnostic setup overhead is symmetrical.
  const comparedCompilers = process.env.FARM_COMPILER_BASELINE
    ? await Promise.all(
        [process.env.FARM_COMPILER_BASELINE, process.env.FARM_COMPILER_CANDIDATE].map(
          (path) => import(pathToFileURL(path).href),
        ),
      )
    : undefined;
  globalThis.__farmComparedCompile =
    comparedCompilers?.[
      process.env.FARM_CACHE_BENCH_CHILD === "baseline" ? 0 : 1
    ].compileReactModule;
  const stats = { compiles: 0, transforms: 0, scopes: [], loaded: [] };
  globalThis.__farmBuildCacheProbe = stats;
  registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (!/\/farm-react\/dist\/vite\.(cjs|mjs)$/.test(url)) return loaded;
      let source =
        typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString();
      const replacements = [
        [
          "async function compileReactModule(code, id, options) {",
          "async function compileReactModule(code, id, options) { globalThis.__farmBuildCacheProbe.compiles++;" +
            (comparedCompilers
              ? " return globalThis.__farmComparedCompile(code, id, options);"
              : ""),
        ],
        [
          "const cache = options.buildLifetime",
          "globalThis.__farmBuildCacheProbe.transforms++; const cache = options.buildLifetime",
        ],
        [
          "dispose() {",
          "dispose() { globalThis.__farmBuildCacheProbe.scopes.push({ entries: this.size, bytes: this.retainedBytes });",
        ],
      ];
      if (!comparedCompilers && process.env.FARM_CACHE_BENCH_CHILD === "baseline")
        replacements.push([
          "function createFarmRendererPlugin(options = {}) {",
          "function createFarmRendererPlugin(options = {}) { options = {...options, buildLifetime: undefined};",
        ]);
      for (const [before, after] of replacements) {
        assert.equal(source.split(before).length, 2, `Expected one ${before} in ${url}`);
        source = source.replace(before, after);
      }
      stats.loaded.push(url);
      return { ...loaded, source };
    },
  });
  process.on("exit", () =>
    writeFileSync(process.env.FARM_CACHE_BENCH_STATS, JSON.stringify(stats)),
  );
} else {
  const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const output = await mkdtemp(join(tmpdir(), "farm-compiler-build-bench-"));
  const pairs = Number(process.env.PAIRS || 5);
  assert(Number.isInteger(pairs) && pairs >= 3 && pairs <= 20, "PAIRS must be 3–20");
  let baselineCompilerPath;
  let candidateCompilerPath;
  if (process.env.BASE_REF) {
    const source = execFileSync(
      "git",
      ["show", `${process.env.BASE_REF}:packages/farm-react/src/compiler.ts`],
      { cwd: workspace, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    const require = createRequire(join(workspace, "packages/farm-react/package.json"));
    const { transformWithEsbuild } = require("vite");
    baselineCompilerPath = join(output, "baseline-compiler.mjs");
    candidateCompilerPath = join(output, "candidate-compiler.mjs");
    for (const [compilerSource, compilerPath] of [
      [source, baselineCompilerPath],
      [
        await readFile(join(workspace, "packages/farm-react/src/compiler.ts"), "utf8"),
        candidateCompilerPath,
      ],
    ]) {
      const transformed = await transformWithEsbuild(compilerSource, "compiler.ts", {
        loader: "ts",
        target: "esnext",
      });
      const importPattern = /(["'])@babel\/core\1/g;
      assert.equal([...transformed.code.matchAll(importPattern)].length, 1);
      await writeFile(
        compilerPath,
        transformed.code.replace(
          importPattern,
          JSON.stringify(pathToFileURL(require.resolve("@babel/core")).href),
        ),
      );
    }
  }
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  // Farm gives its generated client entry a fresh mkdtemp suffix per build.
  // Normalize only that filename in the comparison, never report contents.
  // The raw reports remain in each result file for inspection.
  const comparableReport = (report) => {
    const moduleId = (id) =>
      id.replace(
        /^\.farm\/tmp\/client-entry-[A-Za-z0-9]{6}\/farm-client-entry\.tsx$/,
        ".farm/tmp/client-entry-<temporary>/farm-client-entry.tsx",
      );
    return {
      ...report,
      modules: report.modules.map((module) => ({
        ...module,
        id: moduleId(module.id),
        fallbacks: module.fallbacks.map((fallback) => ({
          ...fallback,
          module: moduleId(fallback.module),
        })),
      })),
    };
  };
  const apps = process.argv[2] ? [process.argv[2]] : ["react-compiler", "react-compiler-dashboard"];
  assert(apps.every((app) => ["react-compiler", "react-compiler-dashboard"].includes(app)));
  const summary = {
    node: process.version,
    cpu: cpus()[0].model,
    os: release(),
    pairs,
    baselineCompilerRef: process.env.BASE_REF || null,
    output,
    apps: {},
  };
  for (const app of apps) {
    const root = join(workspace, "examples", app);
    const results = [];
    for (let round = -1; round < pairs; round++) {
      for (const mode of round % 2 === 0 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
        const label = `${app}-${round}-${mode}`;
        const statsPath = join(output, `${label}.json`);
        const startLoad = loadavg();
        const started = performance.now();
        const child = spawn(
          process.execPath,
          [
            "--import",
            import.meta.url,
            join(workspace, "packages/farm-cli/bin/farm.js"),
            "build",
            "--root",
            root,
          ],
          {
            cwd: root,
            env: {
              ...process.env,
              FARM_TELEMETRY_DISABLED: "1",
              FARM_VITE_BUILDER: "rolldown",
              FARM_CACHE_BENCH_CHILD: mode,
              FARM_CACHE_BENCH_STATS: statsPath,
              FARM_COMPILER_BASELINE: baselineCompilerPath || "",
              FARM_COMPILER_CANDIDATE: candidateCompilerPath || "",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let log = "";
        child.stdout.on("data", (chunk) => {
          log += chunk;
        });
        child.stderr.on("data", (chunk) => {
          log += chunk;
        });
        const code = await new Promise((resolve, reject) => {
          child.on("error", reject);
          child.on("close", resolve);
        });
        const elapsedMs = performance.now() - started;
        await writeFile(join(output, `${label}.log`), log);
        assert.equal(code, 0, `Build failed: ${label}\n${log.slice(-3000)}`);
        const stats = JSON.parse(await readFile(statsPath, "utf8"));
        assert(stats.loaded.length > 0 && stats.compiles > 0, "Probe did not observe compilation");
        if (mode === "candidate" || baselineCompilerPath)
          assert(
            stats.compiles < stats.transforms && stats.scopes.length === 1,
            "No cross-graph reuse/disposal",
          );
        else assert.equal(stats.compiles, stats.transforms);
        const publicDir = join(root, ".farm/.output/public");
        const files = (await readdir(publicDir, { recursive: true }))
          .filter((file) => file.endsWith(".js"))
          .sort();
        const payload = [];
        for (const file of files) {
          const contents = await readFile(join(publicDir, file));
          payload.push({ file, bytes: contents.byteLength, hash: digest(contents) });
        }
        const report = JSON.parse(await readFile(join(root, ".farm/react-compiler.json"), "utf8"));
        const result = {
          round,
          mode,
          elapsedMs,
          startLoad,
          endLoad: loadavg(),
          ...stats,
          payload,
          report,
        };
        await writeFile(statsPath, JSON.stringify(result, null, 2));
        if (results.length) {
          assert.deepEqual(payload, results[0].payload, "Browser chunks changed");
          assert.deepEqual(
            comparableReport(report),
            comparableReport(results[0].report),
            "Compiler report changed",
          );
        }
        results.push(result);
        console.log(
          JSON.stringify({
            app,
            round,
            mode,
            elapsedMs,
            compiles: stats.compiles,
            transforms: stats.transforms,
            scopes: stats.scopes,
          }),
        );
      }
    }
    const measured = results.filter((result) => result.round >= 0);
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    summary.apps[app] = {
      baselineMs: measured.filter((r) => r.mode === "baseline").map((r) => r.elapsedMs),
      candidateMs: measured.filter((r) => r.mode === "candidate").map((r) => r.elapsedMs),
      medianBaselineMs: median(
        measured.filter((r) => r.mode === "baseline").map((r) => r.elapsedMs),
      ),
      medianCandidateMs: median(
        measured.filter((r) => r.mode === "candidate").map((r) => r.elapsedMs),
      ),
      browserBytes: results[0].payload.reduce((sum, file) => sum + file.bytes, 0),
    };
  }
  await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
