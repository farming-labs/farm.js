#!/usr/bin/env node
// Platform build benchmark: clean production builds for Node, Vercel and
// Cloudflare Workers, the output each platform deploys, and a cached CI run
// (frozen install from a warm store, then a clean build).
//
// It copies the fixtures in ../apps into a work directory, installs the latest
// published framework versions (Farm.js from npm, not the local packages), and
// applies the files in ./overrides that current versions need. The pinned
// fixtures used by ../run.mjs are not modified.
//
//   node platform/run.mjs [--rounds 5] [--ci-rounds 3] [--only builds,sizes,ci]
//                         [--frameworks farm,next] [--workdir DIR] [--keep]
//
// Requires pnpm. Next.js on Vercel uses the `vercel` CLI from PATH and is
// skipped without it; nothing is deployed and no account is used.
import { execFileSync, execSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPS = path.join(HERE, "..", "apps");
const RESULTS = path.join(HERE, "..", "results", "platform");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const rounds = Number(option("rounds", 5));
const ciRounds = Number(option("ci-rounds", 3));
const only = new Set(option("only", "builds,sizes,ci").split(","));
const keep = args.includes("--keep");
const FRAMEWORKS = option("frameworks", "farm,next,nuxt,sveltekit,tanstack").split(",");
const workdir = path.resolve(option("workdir", mkdtempSync(path.join(tmpdir(), "farm-platform-"))));

// TypeScript is not under test; 7.x drops the JavaScript API Next.js uses.
const TYPESCRIPT = "5.9.3";
const EXTRA_DEV_DEPENDENCIES = {
  next: ["@opennextjs/cloudflare", "wrangler"],
  sveltekit: ["@sveltejs/adapter-vercel", "@sveltejs/adapter-cloudflare"],
};
// pnpm 10+ only runs approved dependency build scripts.
const PNPM_WORKSPACE =
  'allowBuilds:\n  esbuild: true\n  workerd: true\n  sharp: true\n  "@parcel/watcher": true\n';
const GENERATED = [
  ".farm",
  ".next",
  ".open-next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  "build",
  "dist",
  ".tanstack",
  ".nitro",
  ".vercel/output",
  ".wrangler",
  "node_modules/.vite",
  "node_modules/.cache",
];

const run = (cmd, cwd, env = {}) =>
  spawnSync("/usr/bin/time", ["-p", "sh", "-c", cmd], {
    cwd,
    env: {
      ...process.env,
      ...env,
      CI: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      NUXT_TELEMETRY_DISABLED: "1",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 << 20,
  });
const timed = (cmd, cwd, env) => {
  const start = process.hrtime.bigint();
  const result = run(cmd, cwd, env);
  const wall = Number(process.hrtime.bigint() - start) / 1e9;
  const seconds = (key) =>
    Number((result.stderr.match(new RegExp(`^${key} ([0-9.]+)$`, "m")) ?? [])[1]);
  const output = result.stdout + result.stderr;
  return {
    ok: result.status === 0,
    wall: +wall.toFixed(3),
    cpu: +(seconds("user") + seconds("sys")).toFixed(2),
    ...(result.status === 0
      ? {}
      : {
          error:
            output
              .split("\n")
              .filter((line) => /error|fatal|panic/i.test(line))
              .slice(0, 3)
              .join(" | ") || output.slice(-300),
        }),
  };
};
const latest = (name) =>
  execFileSync("npm", ["view", name, "version"], { encoding: "utf8" }).trim();
const hasVercelCli = spawnSync("sh", ["-c", "command -v vercel"]).status === 0;

/** Copies a fixture, pins the latest versions, and installs it. */
function setup(fw, dir, { platforms }) {
  rmSync(dir, { recursive: true, force: true });
  cpSync(path.join(APPS, fw), dir, {
    recursive: true,
    filter: (source) =>
      !/[/\\](node_modules|\.farm|\.next|\.nuxt|\.output|\.svelte-kit|build)([/\\]|$)/.test(
        source.slice(APPS.length),
      ),
  });
  if (fw === "sveltekit") rmSync(path.join(dir, "svelte.config.js"), { force: true });
  const overrides = path.join(HERE, "overrides", fw);
  if (existsSync(overrides)) cpSync(overrides, dir, { recursive: true });
  if (!platforms) {
    // CI copies install only what the Node build needs.
    rmSync(path.join(dir, "wrangler.jsonc"), { force: true });
    rmSync(path.join(dir, "open-next.config.ts"), { force: true });
  }

  const manifestPath = path.join(dir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  delete manifest.packageManager;
  for (const field of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      manifest[field][name] = name === "typescript" ? TYPESCRIPT : latest(name);
    }
  }
  // sharp is an optional peer of @farm.js/core: a default app does not install it.
  delete manifest.dependencies?.sharp;
  if (platforms) {
    for (const name of EXTRA_DEV_DEPENDENCIES[fw] ?? []) {
      (manifest.devDependencies ??= {})[name] = latest(name);
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(dir, "pnpm-workspace.yaml"), PNPM_WORKSPACE);
  if (fw === "next" && platforms) {
    // `vercel build` reads project settings; a placeholder keeps it local.
    mkdirSync(path.join(dir, ".vercel"), { recursive: true });
    writeFileSync(
      path.join(dir, ".vercel", "project.json"),
      JSON.stringify({
        projectId: "prj_benchmark",
        orgId: "team_benchmark",
        settings: { framework: "nextjs" },
      }),
    );
  }
  const install = run("pnpm install", dir);
  if (install.status !== 0) {
    throw new Error(`${fw}: install failed\n${(install.stdout + install.stderr).slice(-600)}`);
  }
  return Object.fromEntries(
    Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
      .filter((name) => !name.startsWith("@types/") && name !== "typescript")
      .map((name) => [name, manifest.dependencies?.[name] ?? manifest.devDependencies[name]]),
  );
}

const BUILD = {
  node: {
    farm: ["pnpm exec farm build --preset node-server"],
    next: ["pnpm exec next build"],
    nuxt: ["pnpm exec nuxt build", { NITRO_PRESET: "node-server" }],
    sveltekit: ["pnpm exec vite build", { BENCH_TARGET: "node" }],
    tanstack: ["pnpm exec vite build", { NITRO_PRESET: "node-server" }],
  },
  vercel: {
    farm: ["pnpm exec farm build --preset vercel"],
    next: hasVercelCli ? ["vercel build --yes"] : null,
    nuxt: ["pnpm exec nuxt build", { NITRO_PRESET: "vercel" }],
    sveltekit: ["pnpm exec vite build", { BENCH_TARGET: "vercel" }],
    tanstack: ["pnpm exec vite build", { NITRO_PRESET: "vercel" }],
  },
  cloudflare: {
    farm: ["pnpm exec farm build --preset cloudflare-module"],
    next: ["pnpm exec opennextjs-cloudflare build"],
    nuxt: ["pnpm exec nuxt build", { NITRO_PRESET: "cloudflare_module" }],
    sveltekit: ["pnpm exec vite build", { BENCH_TARGET: "cloudflare" }],
    tanstack: ["pnpm exec vite build", { NITRO_PRESET: "cloudflare_module" }],
  },
};

const kb = (target) =>
  existsSync(target) ? Number(execSync(`du -skL "${target}"`).toString().split("\t")[0]) : null;
const gzipKb = (target) =>
  existsSync(target)
    ? Math.round(
        Number(
          execSync(
            `tar -chf - -C "${path.dirname(target)}" "${path.basename(target)}" | gzip -6 | wc -c`,
          )
            .toString()
            .trim(),
        ) / 1024,
      )
    : null;
/** What `wrangler deploy` would upload, without deploying. */
function wranglerUpload(wrangler, cwd, deployArgs) {
  const outdir = mkdtempSync(path.join(tmpdir(), "farm-platform-wrangler-"));
  const result = spawnSync(
    "sh",
    ["-c", `"${wrangler}" deploy --dry-run --outdir "${outdir}" ${deployArgs}`],
    { cwd, encoding: "utf8" },
  );
  rmSync(outdir, { recursive: true, force: true });
  const match = (result.stdout + result.stderr).match(
    /Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/,
  );
  return match
    ? { uploadKiB: +match[1], uploadGzipKiB: +match[2] }
    : { uploadError: (result.stdout + result.stderr).slice(-300) };
}
const MEASURE = {
  node: {
    // Nitro output carries its own dependencies; Next.js and adapter-node
    // output also needs node_modules at runtime.
    farm: (d) => ({ outputKB: kb(`${d}/.farm/.output`), selfContained: true }),
    next: (d) => ({
      outputKB: kb(`${d}/.next`) - (kb(`${d}/.next/cache`) ?? 0),
      selfContained: false,
    }),
    nuxt: (d) => ({ outputKB: kb(`${d}/.output`), selfContained: true }),
    sveltekit: (d) => ({ outputKB: kb(`${d}/build`), selfContained: false }),
    tanstack: (d) => ({ outputKB: kb(`${d}/.output`), selfContained: true }),
  },
  vercel: (d) => ({
    functionsKB: kb(`${d}/.vercel/output/functions`),
    functionsGzipKB: gzipKb(`${d}/.vercel/output/functions`),
    staticKB: kb(`${d}/.vercel/output/static`),
  }),
  cloudflare: {
    farm: (d, w) => ({
      ...wranglerUpload(w, d, "-c .farm/.output/server/wrangler.json"),
      assetsKB: kb(`${d}/.farm/.output/public`),
    }),
    next: (d, w) => ({
      ...wranglerUpload(w, d, "-c wrangler.jsonc"),
      assetsKB: kb(`${d}/.open-next/assets`),
    }),
    nuxt: (d, w) => ({
      ...wranglerUpload(
        w,
        `${d}/.output`,
        "server/index.mjs --assets public --name bench-nuxt --compatibility-date 2026-10-01 --compatibility-flags nodejs_compat",
      ),
      assetsKB: kb(`${d}/.output/public`),
    }),
    sveltekit: (d, w) => ({
      ...wranglerUpload(w, d, "-c wrangler.jsonc"),
      assetsKB: kb(`${d}/.svelte-kit/cloudflare`),
    }),
    tanstack: (d, w) => ({
      ...wranglerUpload(w, d, "-c .output/server/wrangler.json"),
      assetsKB: kb(`${d}/.output/public`),
    }),
  },
};

const clean = (dir) =>
  GENERATED.forEach((p) => rmSync(path.join(dir, p), { recursive: true, force: true }));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const report = {
  date: new Date().toISOString(),
  node: process.versions.node,
  cpus: cpus().length,
  cpuModel: cpus()[0]?.model,
  loadAverageAtStart: loadavg().map((n) => +n.toFixed(2)),
  versions: {},
  builds: [],
  sizes: {},
  ci: [],
};

mkdirSync(workdir, { recursive: true });
console.log(`work directory: ${workdir}`);
const platformDir = (fw) => path.join(workdir, "platform", fw);
const ciDir = (fw) => path.join(workdir, "ci", fw);

if (only.has("builds") || only.has("sizes")) {
  for (const fw of FRAMEWORKS) {
    console.log(`setting up ${fw}`);
    report.versions[fw] = setup(fw, platformDir(fw), { platforms: true });
  }
}
const wrangler = path.join(platformDir("next"), "node_modules", ".bin", "wrangler");

if (only.has("builds")) {
  for (let round = 0; round < rounds; round++) {
    // Rotate the order so no framework always runs first after a quiet period.
    const order = FRAMEWORKS.map((_, i) => FRAMEWORKS[(i + round) % FRAMEWORKS.length]);
    for (const target of Object.keys(BUILD)) {
      for (const fw of order) {
        const build = BUILD[target][fw];
        if (!build) continue;
        clean(platformDir(fw));
        const row = { round, target, fw, ...timed(build[0], platformDir(fw), build[1]) };
        report.builds.push(row);
        console.log(JSON.stringify(row));
      }
    }
  }
}

if (only.has("sizes")) {
  for (const target of Object.keys(BUILD)) {
    for (const fw of FRAMEWORKS) {
      const build = BUILD[target][fw];
      if (!build) continue;
      const dir = platformDir(fw);
      clean(dir);
      const result = run(build[0], dir, build[1]);
      const measure = typeof MEASURE[target] === "function" ? MEASURE[target] : MEASURE[target][fw];
      const sizes =
        result.status === 0
          ? measure(dir, wrangler)
          : { buildError: (result.stdout + result.stderr).slice(-300) };
      (report.sizes[target] ??= {})[fw] = sizes;
      console.log(target, fw, JSON.stringify(sizes));
    }
  }
}

if (only.has("ci")) {
  for (const fw of FRAMEWORKS) {
    console.log(`setting up ${fw} for CI`);
    const versions = setup(fw, ciDir(fw), { platforms: false });
    report.versions[fw] ??= versions;
  }
  for (let round = 0; round < ciRounds; round++) {
    for (const fw of FRAMEWORKS.map((_, i) => FRAMEWORKS[(i + round) % FRAMEWORKS.length])) {
      const dir = ciDir(fw);
      rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
      clean(dir);
      const install = timed("pnpm install --frozen-lockfile --prefer-offline", dir);
      const [cmd, env] = BUILD.node[fw];
      const build = install.ok ? timed(cmd, dir, env) : { ok: false, wall: 0, cpu: 0 };
      const row = {
        round,
        fw,
        ok: install.ok && build.ok,
        install: install.wall,
        build: build.wall,
        buildCpu: build.cpu,
      };
      if (!row.ok) row.error = install.error ?? build.error;
      report.ci.push(row);
      console.log(JSON.stringify(row));
    }
  }
}

// Summary tables.
const lines = [`# Platform builds (${report.date.slice(0, 10)})`, ""];
lines.push(
  `Node ${report.node}, ${report.cpus} x ${report.cpuModel}, load average at start ${report.loadAverageAtStart.join(" / ")}.`,
  "",
);
lines.push("| Framework | Versions |", "| --- | --- |");
for (const fw of FRAMEWORKS) {
  lines.push(
    `| ${fw} | ${Object.entries(report.versions[fw] ?? {})
      .map(([n, v]) => `${n} ${v}`)
      .join(", ")} |`,
  );
}
if (report.builds.length) {
  lines.push(
    "",
    "## Clean build, median wall seconds (median CPU seconds)",
    "",
    "| Framework | Node | Vercel | Cloudflare |",
    "| --- | --- | --- | --- |",
  );
  for (const fw of FRAMEWORKS) {
    const cell = (target) => {
      const rows = report.builds.filter((r) => r.fw === fw && r.target === target && r.ok);
      const failed = report.builds.filter(
        (r) => r.fw === fw && r.target === target && !r.ok,
      ).length;
      if (!rows.length) return BUILD[target][fw] ? "failed" : "skipped";
      return `${median(rows.map((r) => r.wall)).toFixed(2)} (${median(rows.map((r) => r.cpu)).toFixed(2)})${failed ? ` ${failed} failed` : ""}`;
    };
    lines.push(`| ${fw} | ${cell("node")} | ${cell("vercel")} | ${cell("cloudflare")} |`);
  }
}
if (Object.keys(report.sizes).length) {
  lines.push(
    "",
    "## Deployed output",
    "",
    "| Framework | Node output KB | Vercel functions KB (gzip) | Cloudflare upload KiB (gzip) |",
    "| --- | --- | --- | --- |",
  );
  for (const fw of FRAMEWORKS) {
    const n = report.sizes.node?.[fw];
    const v = report.sizes.vercel?.[fw];
    const c = report.sizes.cloudflare?.[fw];
    lines.push(
      `| ${fw} | ${n?.outputKB ?? "-"}${n && !n.selfContained ? " + node_modules" : ""} | ${v?.functionsKB ?? "-"} (${v?.functionsGzipKB ?? "-"}) | ${c?.uploadKiB ?? "-"} (${c?.uploadGzipKiB ?? "-"}) |`,
    );
  }
}
if (report.ci.length) {
  lines.push(
    "",
    "## Cached CI: frozen install from a warm store, then a clean Node build (median seconds)",
    "",
    "| Framework | Install | Build | Total |",
    "| --- | --- | --- | --- |",
  );
  for (const fw of FRAMEWORKS) {
    const rows = report.ci.filter((r) => r.fw === fw && r.ok);
    if (!rows.length) {
      lines.push(`| ${fw} | failed | | |`);
      continue;
    }
    lines.push(
      `| ${fw} | ${median(rows.map((r) => r.install)).toFixed(2)} | ${median(rows.map((r) => r.build)).toFixed(2)} | ${median(rows.map((r) => r.install + r.build)).toFixed(2)} |`,
    );
  }
}
mkdirSync(RESULTS, { recursive: true });
const stamp = report.date.replace(/[:.]/g, "-");
writeFileSync(path.join(RESULTS, `${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(RESULTS, `${stamp}.md`), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}\n\nresults: ${path.join(RESULTS, stamp)}.{json,md}`);
if (!keep) rmSync(workdir, { recursive: true, force: true });
