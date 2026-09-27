import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  formatFarmDoctorReport,
  generateFarmArtifacts,
  runFarmDoctor,
} = require("../dist/index.js");
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

test("preserves live runtime health without matching diagnostics", async () => {
  for (const [health, status] of [
    ["attention", "warn"],
    ["error", "fail"],
  ]) {
    const report = await runFarmDoctor({
      url: "http://localhost:4319",
      fetch: async () =>
        Response.json({
          health,
          project: { name: "storefront", root: "/repo/storefront" },
          deployment: { target: "node", preset: "node-server" },
          counts: {
            pages: 1,
            layouts: 1,
            apiRoutes: 0,
            middleware: 0,
            integrations: 0,
            storageMounts: 0,
            cronJobs: 0,
            workflows: 0,
          },
          diagnostics: [],
        }),
    });

    assert.equal(report.health, health);
    assert.ok(
      report.checks.some(
        (check) => check.code === "LIVE_RUNTIME_HEALTH" && check.status === status,
      ),
    );
  }
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

test("enforces the Node 22.13 runtime baseline", async () => {
  const root = await createTempProject();
  const originalNodeVersion = Object.getOwnPropertyDescriptor(process.versions, "node");

  try {
    Object.defineProperty(process.versions, "node", {
      ...originalNodeVersion,
      configurable: true,
      value: "22.12.0",
    });
    const unsupported = await runFarmDoctor({ root, offline: true });
    const unsupportedCheck = unsupported.checks.find((check) => check.code === "NODE_UNSUPPORTED");
    assert.equal(unsupportedCheck?.status, "fail");
    assert.equal(unsupportedCheck?.action, "Upgrade Node.js to version 22.13 or newer.");

    Object.defineProperty(process.versions, "node", {
      ...originalNodeVersion,
      configurable: true,
      value: "22.13.0",
    });
    const supported = await runFarmDoctor({ root, offline: true });
    assert.ok(supported.checks.some((check) => check.code === "NODE_SUPPORTED"));
  } finally {
    if (originalNodeVersion) {
      Object.defineProperty(process.versions, "node", originalNodeVersion);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("reports conflicting package-manager signals and an unsupported pnpm version", async () => {
  const root = await createTempProject();

  try {
    const packagePath = path.join(root, "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    packageJson.packageManager = "pnpm@7.33.0";
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '6.0'\n");
    await writeFile(path.join(root, "package-lock.json"), "{}\n");

    const report = await runFarmDoctor({
      root,
      offline: true,
      env: { npm_config_user_agent: "pnpm/7.33.0 npm/? node/v22.13.0" },
    });

    assert.ok(report.checks.some((check) => check.code === "PACKAGE_MANAGER_CONFLICT"));
    assert.ok(
      report.checks.some((check) => check.code === "PNPM_UNSUPPORTED" && check.status === "fail"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves workspace protocol dependencies from a workspace root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-doctor-workspace-"));

  try {
    await mkdir(path.join(root, "packages/core"), { recursive: true });
    await mkdir(path.join(root, "src/app"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "doctor-workspace",
        packageManager: "pnpm@8.12.1",
        dependencies: { "@farm.js/core": "workspace:*" },
      }),
    );
    await writeFile(path.join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    await writeFile(
      path.join(root, "packages/core/package.json"),
      JSON.stringify({ name: "@farm.js/core", version: "0.1.0-beta.106" }),
    );
    await writeFile(path.join(root, "farm.config.mjs"), "export default {};\n");
    await writeFile(path.join(root, "src/app/page.tsx"), "export default () => null;\n");
    await writeFile(
      path.join(root, "src/app/layout.tsx"),
      "export default ({ children }) => children;\n",
    );
    await generateFarmArtifacts({ root });

    const report = await runFarmDoctor({ root, offline: true });

    assert.ok(report.checks.some((check) => check.code === "LOCAL_PACKAGES_RESOLVED"));
    assert.ok(!report.checks.some((check) => check.code === "LOCAL_PACKAGES_MISSING"));
    assert.ok(report.checks.some((check) => check.code === "PNPM_SUPPORTED"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails when a workspace protocol dependency has no local package", async () => {
  const root = await createTempProject();

  try {
    const packagePath = path.join(root, "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    packageJson.packageManager = "pnpm@8.12.1";
    packageJson.dependencies["@farm.js/core"] = "workspace:*";
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    await writeFile(path.join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');

    const report = await runFarmDoctor({ root, offline: true });
    const check = report.checks.find((entry) => entry.code === "LOCAL_PACKAGES_MISSING");

    assert.equal(report.health, "error");
    assert.equal(check?.status, "fail");
    assert.match(check?.message || "", /@farm\.js\/core \(workspace:\*\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detects stale generated artifacts without changing them", async () => {
  const root = await createTempProject();
  const typesPath = path.join(root, "src/farm.d.ts");

  try {
    const staleSource = `${await readFile(typesPath, "utf8")}\n// stale\n`;
    await writeFile(typesPath, staleSource);

    const report = await runFarmDoctor({ root, offline: true });
    const check = report.checks.find((entry) => entry.code === "GENERATED_ARTIFACTS_STALE");

    assert.equal(check?.status, "fail");
    assert.match(check?.message || "", /src\/farm\.d\.ts/);
    assert.equal(await readFile(typesPath, "utf8"), staleSource);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports missing renderer entrypoints without importing them", async () => {
  const root = await createTempProject();

  try {
    await writeFile(
      path.join(root, "farm.config.mjs"),
      `export default {
  renderer: {
    name: "missing",
    vite: "missing-renderer/vite",
    server: "missing-renderer/server",
    client: "missing-renderer/client",
    componentExtensions: [".tsx"],
  },
};
`,
    );

    const report = await runFarmDoctor({ root, offline: true });
    const check = report.checks.find((entry) => entry.code === "RENDERER_ENTRYPOINTS_MISSING");

    assert.equal(check?.status, "fail");
    assert.match(check?.message || "", /missing-renderer\/server/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports loaded integrations and declared Farm packages that are not installed", async () => {
  const root = await createTempProject();

  try {
    const packagePath = path.join(root, "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    packageJson.dependencies["@farm.js/missing-provider"] = "0.1.0-beta.1";
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    await writeFile(
      path.join(root, "farm.config.mjs"),
      `export default {
  integrations: {
    billing: {
      kind: "farm-integration",
      category: "payments",
      type: "stripe",
      instance: {},
    },
  },
};
`,
    );
    await generateFarmArtifacts({ root });

    const report = await runFarmDoctor({ root, offline: true });
    const integrationCheck = report.checks.find(
      (entry) => entry.code === "INTEGRATION_ENTRYPOINTS_READY",
    );
    const packageCheck = report.checks.find(
      (entry) => entry.code === "FARM_PACKAGES_NOT_INSTALLED",
    );

    assert.equal(integrationCheck?.status, "pass");
    assert.match(integrationCheck?.message || "", /billing \(stripe\)/);
    assert.equal(packageCheck?.status, "warn");
    assert.match(packageCheck?.message || "", /@farm\.js\/missing-provider/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checks beta registry tags only when requested and reports a stale beta", async () => {
  const root = await createTempProject();
  const typesPath = path.join(root, "src/farm.d.ts");
  const before = await readFile(typesPath, "utf8");
  const requests = [];

  try {
    const report = await runFarmDoctor({
      root,
      offline: true,
      registry: true,
      fetch: async (input) => {
        requests.push(String(input));
        return Response.json({
          "dist-tags": { beta: "0.1.0-beta.107" },
          versions: { "0.1.0-beta.107": {} },
        });
      },
    });

    assert.deepEqual(requests, [
      "https://registry.npmjs.org/%40farm.js%2Fcore",
      "https://registry.npmjs.org/%40farm.js%2Fcreate-app",
    ]);
    assert.ok(report.checks.some((check) => check.code === "REGISTRY_BETA_RESOLVED"));
    assert.ok(report.checks.some((check) => check.code === "FARM_BETA_STALE"));
    assert.equal(await readFile(typesPath, "utf8"), before);
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

test("finds cron routes mounted under a custom API base path", async () => {
  const root = await createTempProject({
    apiBasePath: "/v2/api",
    cronPath: "/v2/api/maintenance/cleanup",
  });

  try {
    const report = await runFarmDoctor({
      root,
      offline: true,
      env: { CRON_SECRET: "configured" },
    });

    assert.ok(!report.checks.some((check) => check.code === "CRON_ROUTE_MISSING"));
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

test("exits non-zero with a machine-readable report when a check fails", async () => {
  const root = await createTempProject();

  try {
    const typesPath = path.join(root, "src/farm.d.ts");
    await writeFile(typesPath, `${await readFile(typesPath, "utf8")}\n// stale\n`);

    await assert.rejects(
      execFileAsync(process.execPath, [cliBin, "doctor", "--offline", "--root", root, "--json"]),
      (error) => {
        const report = JSON.parse(error.stdout);
        assert.equal(error.code, 1);
        assert.equal(report.health, "error");
        assert.ok(report.checks.some((check) => check.code === "GENERATED_ARTIFACTS_STALE"));
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applies only safe additive fixes", async () => {
  const root = await createTempProject({ layout: false });
  const layoutPath = path.join(root, "src/app/layout.tsx");

  try {
    const report = await runFarmDoctor({ root, offline: true, fix: true });

    assert.deepEqual(report.fixes, [
      {
        code: "ROOT_LAYOUT_CREATED",
        title: "Created the missing root layout",
        filePath: "src/app/layout.tsx",
      },
    ]);
    assert.ok(report.checks.some((check) => check.code === "ROOT_LAYOUT_READY"));
    assert.match(await readFile(layoutPath, "utf8"), /export default function RootLayout/);

    const before = (await stat(layoutPath)).mtimeMs;
    const repeated = await runFarmDoctor({ root, offline: true, fix: true });
    assert.deepEqual(repeated.fixes, []);
    assert.equal((await stat(layoutPath)).mtimeMs, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recognizes Vue pages and creates a Vue root layout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-doctor-vue-"));
  const layoutPath = path.join(root, "src/app/layout.vue");

  try {
    await mkdir(path.join(root, "src/app"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "vue-doctor" }));
    await writeFile(
      path.join(root, "farm.config.mjs"),
      `export default {
  renderer: {
    name: "vue",
    vite: "@farm.js/vue/vite",
    server: "@farm.js/vue/server",
    client: "@farm.js/vue/client",
    componentExtensions: [".vue"],
  },
};
`,
    );
    await writeFile(path.join(root, "src/app/page.vue"), "<template><main>Vue</main></template>\n");

    const report = await runFarmDoctor({ root, offline: true, fix: true });

    assert.deepEqual(report.fixes, [
      {
        code: "ROOT_LAYOUT_CREATED",
        title: "Created the missing root layout",
        filePath: "src/app/layout.vue",
      },
    ]);
    assert.ok(report.checks.some((check) => check.code === "APP_ROUTER_READY"));
    assert.match(await readFile(layoutPath, "utf8"), /<slot \/>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recognizes routes using the configured renderer extension", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-doctor-svelte-"));

  try {
    await mkdir(path.join(root, "src/app"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "svelte-doctor", dependencies: { "@farm.js/core": "workspace:*" } }),
    );
    await writeFile(
      path.join(root, "farm.config.mjs"),
      `export default {
  renderer: {
    name: "svelte",
    vite: "@farm.js/svelte/vite",
    server: "@farm.js/svelte/server",
    client: "@farm.js/svelte/client",
    componentExtensions: [".svelte"],
  },
};
`,
    );
    await writeFile(path.join(root, "src/app/page.svelte"), "<main>Svelte</main>\n");
    await writeFile(path.join(root, "src/app/layout.svelte"), "<slot />\n");

    const report = await runFarmDoctor({ root, offline: true });

    assert.ok(report.checks.some((check) => check.code === "APP_ROUTER_READY"));
    assert.ok(report.checks.some((check) => check.code === "ROOT_LAYOUT_READY"));
    assert.ok(!report.checks.some((check) => check.code === "NO_PAGE_ROUTES"));
    assert.ok(!report.checks.some((check) => check.code === "ROOT_LAYOUT_MISSING"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const fixture of [
  {
    renderer: "preact",
    extension: ".tsx",
    expected: /ComponentChildren.*from "preact"/,
    rejected: /from "react"/,
  },
  {
    renderer: "svelte",
    extension: ".svelte",
    expected: /Snippet.*from "svelte"/,
    rejected: /from "react"/,
  },
]) {
  test(`creates a ${fixture.renderer} root layout with renderer-native source`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `farm-cli-doctor-${fixture.renderer}-`));
    const layoutPath = path.join(root, `src/app/layout${fixture.extension}`);

    try {
      await mkdir(path.join(root, "src/app"), { recursive: true });
      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          name: `${fixture.renderer}-doctor`,
          dependencies: { "@farm.js/core": "workspace:*" },
        }),
      );
      await writeFile(
        path.join(root, "farm.config.mjs"),
        `export default {
  renderer: {
    name: ${JSON.stringify(fixture.renderer)},
    vite: "@farm.js/${fixture.renderer}/vite",
    server: "@farm.js/${fixture.renderer}/server",
    client: "@farm.js/${fixture.renderer}/client",
    componentExtensions: [${JSON.stringify(fixture.extension)}],
  },
};
`,
      );

      const report = await runFarmDoctor({ root, offline: true, fix: true });
      const source = await readFile(layoutPath, "utf8");

      assert.ok(report.fixes?.some((fix) => fix.filePath.endsWith(`layout${fixture.extension}`)));
      assert.match(source, fixture.expected);
      assert.doesNotMatch(source, fixture.rejected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("applies safe fixes inside a configured project root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-doctor-root-"));
  const projectRoot = path.join(root, "application");
  const layoutPath = path.join(projectRoot, "src/app/layout.tsx");

  try {
    await mkdir(path.join(projectRoot, "src/app"), { recursive: true });
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { root: './application' };\n",
    );
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "doctor-root-fixture" }),
    );
    await writeFile(path.join(projectRoot, "src/app/page.tsx"), "export default () => null;\n");

    const report = await runFarmDoctor({ root, offline: true, fix: true });

    assert.deepEqual(report.fixes, [
      {
        code: "ROOT_LAYOUT_CREATED",
        title: "Created the missing root layout",
        filePath: "application/src/app/layout.tsx",
      },
    ]);
    assert.match(await readFile(layoutPath, "utf8"), /export default function RootLayout/);
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
      dependencies: { "@farm.js/core": "0.1.0-beta.106" },
    }),
    "utf8",
  );
  await writeFile(
    path.join(root, "farm.config.mjs"),
    [
      "export default {",
      `  deploy: { target: '${target}' },`,
      ...(options.apiBasePath ? [`  api: { basePath: '${options.apiBasePath}' },`] : []),
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
  if (options.layout !== false) {
    await writeFile(
      path.join(root, "src/app/layout.tsx"),
      "export default ({ children }) => children;\n",
      "utf8",
    );
  }
  await writeFile(
    path.join(root, "src/app/api/maintenance/cleanup/route.ts"),
    "export function GET() { return Response.json({ ok: true }); }\n",
    "utf8",
  );
  await generateFarmArtifacts({ root });
  return root;
}
