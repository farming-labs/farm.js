import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { formatFarmDoctorReport, runFarmDoctor } = require("../dist/index.js");
const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

test("uses the running DevTools snapshot as the source of truth", async () => {
  let requestedUrl;
  const report = await runFarmDoctor({
    url: "http://localhost:4319/",
    fetch: async (input) => {
      requestedUrl = String(input);
      return Response.json({
        generatedAt: "2026-07-20T10:00:00.000Z",
        health: "attention",
        project: { name: "storefront", root: "/repo/storefront" },
        deployment: { target: "vercel", preset: "vercel" },
        counts: {
          pages: 8,
          layouts: 1,
          apiRoutes: 4,
          middleware: 2,
          integrations: 3,
          storageMounts: 2,
          cronJobs: 1,
          workflows: 0,
        },
        diagnostics: [
          {
            severity: "warning",
            code: "EPHEMERAL_PRODUCTION_STORAGE",
            title: "Production storage is in memory",
            message: "Vercel instances do not preserve in-memory data.",
          },
        ],
      });
    },
  });

  assert.equal(requestedUrl, "http://localhost:4319/__farm/devtools.json");
  assert.equal(report.source, "live");
  assert.equal(report.health, "attention");
  assert.equal(report.runtime.pages, 8);
  assert.equal(report.target.devtoolsUrl, "http://localhost:4319/__farm/devtools");
  assert.ok(report.checks.some((check) => check.code === "EPHEMERAL_PRODUCTION_STORAGE"));
});

test("inspects a project without starting its runtime", async () => {
  const root = await createTempProject();

  try {
    const report = await runFarmDoctor({
      root,
      offline: true,
      env: { CRON_SECRET: "configured" },
      now: () => new Date("2026-07-20T10:00:00.000Z"),
    });

    assert.equal(report.source, "project");
    assert.equal(report.health, "ready");
    assert.deepEqual(
      report.checks.filter((check) => check.status === "fail" || check.status === "warn"),
      [],
    );
    assert.ok(report.checks.some((check) => check.code === "APP_ROUTER_READY"));
    assert.ok(report.checks.some((check) => check.code === "DEPLOYMENT_RESOLVED"));

    const output = formatFarmDoctorReport(report, { color: false });
    assert.match(output, /FARM \/ DOCTOR/);
    assert.match(output, /App router has route modules/);
    assert.match(output, /SUMMARY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports missing cron routes and ephemeral serverless storage", async () => {
  const root = await createTempProject({
    target: "vercel",
    storage: "{ mounts: { cache: { driver: 'memory' } } }",
    cronPath: "/api/missing",
  });

  try {
    const report = await runFarmDoctor({ root, offline: true, env: {} });
    const codes = report.checks.map((check) => check.code);

    assert.equal(report.health, "attention");
    assert.ok(codes.includes("CRON_ROUTE_MISSING"));
    assert.ok(codes.includes("CRON_SECRET_NOT_SET"));
    assert.ok(codes.includes("EPHEMERAL_PRODUCTION_STORAGE"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prints a machine-readable report through the CLI", async () => {
  const root = await createTempProject();

  try {
    const result = await execFileAsync(
      process.execPath,
      [cliBin, "doctor", "--offline", "--root", root, "--json"],
      { env: { ...process.env, CRON_SECRET: "configured" } },
    );
    const report = JSON.parse(result.stdout);

    assert.equal(report.source, "project");
    assert.equal(report.health, "ready");
    assert.equal(report.project.root, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createTempProject(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-doctor-"));
  const target = options.target || "node";
  const storage = options.storage || "{ driver: 'local' }";
  const cronPath = options.cronPath || "/api/maintenance/cleanup";

  await mkdir(path.join(root, "src/app/api/maintenance/cleanup"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "doctor-fixture",
      dependencies: { "@farmjs/core": "workspace:*" },
    }),
    "utf8",
  );
  await writeFile(
    path.join(root, "farm.config.mjs"),
    [
      "export default {",
      `  deploy: { target: '${target}' },`,
      `  storage: ${storage},`,
      "  cron: {",
      `    cleanup: { schedule: '0 2 * * *', path: '${cronPath}' },`,
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(path.join(root, "src/app/page.tsx"), "export default () => null;\n", "utf8");
  await writeFile(
    path.join(root, "src/app/layout.tsx"),
    "export default ({ children }) => children;\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src/app/api/maintenance/cleanup/route.ts"),
    "export function GET() { return Response.json({ ok: true }); }\n",
    "utf8",
  );
  return root;
}
