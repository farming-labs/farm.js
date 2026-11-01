import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, "..");
const cliBin = path.join(cliRoot, "bin", "farm.js");
const coreRoot = path.resolve(cliRoot, "..", "farm");

const PAGE = "export default function Page() { return null; }";
const APP_FILES = {
  "package.json": JSON.stringify({ name: "notes", version: "1.0.0", type: "module" }),
  "src/app/layout.tsx": "export default function Layout({ children }) { return children; }",
  "src/app/page.tsx": PAGE,
  "src/app/notes/page.tsx": PAGE,
  "src/app/notes/new/page.tsx": PAGE,
  "src/app/notes/[id]/page.tsx": PAGE,
  "src/app/(account)/settings/page.tsx": PAGE,
};

async function createApp(t, config) {
  // Inside the package, so node resolution finds the workspace's Vite and plugins.
  const root = await mkdtemp(path.join(cliRoot, ".tmp-mobile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await symlink(coreRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await symlink(
      await realpath(path.join(coreRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  for (const [file, source] of Object.entries({ ...APP_FILES, "farm.config.ts": config })) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), source);
  }
  return root;
}

async function runFarm(args) {
  try {
    const result = await execFileAsync(process.execPath, [cliBin, ...args], {
      env: { ...process.env, FARM_TELEMETRY_DISABLED: "1" },
      timeout: 180_000,
    });
    return { code: 0, output: result.stdout + result.stderr };
  } catch (error) {
    return { code: error.code, output: String(error.stdout) + String(error.stderr) };
  }
}

const CONFIG = `export default {
  telemetry: false,
  mobile: ({ os, command, profile }) => ({
    id: profile === "beta" ? "com.example.notes.beta" : "com.example.notes",
    server: command === "dev" ? "http://10.0.2.2:3000" : "https://notes.example.com",
    tabs: [
      { path: "/notes", title: "Notes", icon: os === "ios" ? "note.text" : "ic_notes" },
      { path: "/settings", title: "Settings", icon: "gear" },
    ],
    routes: { "/notes/new": { presentation: "modal" } },
  }),
};`;

test("farm config inspect --mobile prints the block and farm-routes.json for an OS and profile", async (t) => {
  const root = await createApp(t, CONFIG);
  const result = await runFarm([
    "config",
    "inspect",
    "--mobile",
    "--os",
    "ios",
    "--profile",
    "beta",
    "--command",
    "dev",
    "--root",
    root,
  ]);
  assert.equal(result.code, 0, result.output);
  const printed = JSON.parse(result.output.slice(result.output.indexOf("{")));
  assert.deepEqual(printed.context, {
    os: "ios",
    mode: "development",
    command: "dev",
    profile: "beta",
  });
  assert.deepEqual(printed.mobile, {
    name: "notes",
    id: "com.example.notes.beta",
    server: "http://10.0.2.2:3000",
    tabs: [
      { path: "/notes", title: "Notes", icon: "note.text" },
      { path: "/settings", title: "Settings", icon: "gear" },
    ],
    routes: { "/notes/new": { presentation: "modal" } },
  });
  assert.deepEqual(printed.routes.rules, [
    { route: "/notes/new", pattern: "^/notes/new/?$", presentation: "modal" },
    { route: "/notes/[id]", pattern: "^/notes/[^/]+/?$", presentation: "push" },
    { route: "/notes", pattern: "^/notes/?$", presentation: "tab", tab: 0 },
    { route: "/settings", pattern: "^/settings/?$", presentation: "tab", tab: 1 },
    { route: "/", pattern: "^/?$", presentation: "push" },
    { pattern: "^/", presentation: "push" },
  ]);
});

test("farm config inspect --mobile names the OS and field when the block is invalid or missing", async (t) => {
  const root = await createApp(t, CONFIG);
  // Defaults: android, build, production.
  const build = await runFarm(["config", "inspect", "--mobile", "--root", root]);
  assert.equal(build.code, 0, build.output);
  const printed = JSON.parse(build.output.slice(build.output.indexOf("{")));
  assert.equal(printed.routes.server, "https://notes.example.com");
  assert.equal(printed.mobile.tabs[0].icon, "ic_notes");

  await writeFile(
    path.join(root, "farm.config.ts"),
    `export default { mobile: { id: "com.example.notes", server: "http://10.0.2.2:3000" } };`,
  );
  const http = await runFarm(["config", "inspect", "--mobile", "--root", root]);
  assert.notEqual(http.code, 0);
  assert.match(http.output, /mobile \(os: android\): server must use https:\/\/ in a build/);

  await writeFile(path.join(root, "farm.config.ts"), `export default { telemetry: false };`);
  const missing = await runFarm(["config", "inspect", "--mobile", "--root", root]);
  assert.notEqual(missing.code, 0);
  assert.match(missing.output, /farm\.config\.ts has no `mobile` entry/);
  // Expected failures print their fix without a stack.
  assert.doesNotMatch(missing.output, /\n\s+at /);

  const both = await runFarm(["config", "inspect", "--mobile", "--desktop", "--root", root]);
  assert.notEqual(both.code, 0);
  assert.match(both.output, /Choose one block: --desktop or --mobile/);
});
