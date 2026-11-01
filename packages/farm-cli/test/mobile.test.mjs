import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
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

async function runFarm(args, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cliBin, ...args], {
      env: { ...process.env, FARM_TELEMETRY_DISABLED: "1", ...env },
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

/**
 * A stand-in for @farm.js/mobile/android: generate() writes what it was given, run() records the
 * context and reports nothing connected, package() writes one artifact.
 */
const FAKE_SHELL = `import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export default {
  os: "android",
  generate(context) {
    return [
      { path: "context.json", contents: JSON.stringify({
        command: context.command,
        basePath: context.basePath,
        id: context.mobile.id,
        server: context.manifest.server,
        projectDir: path.relative(context.root, context.projectDir),
      }) },
      { path: "gradlew", contents: "#!/bin/sh\\n", executable: true },
      ...(process.env.FAKE_SHELL_ESCAPE ? [{ path: "../escape.txt", contents: "x" }] : []),
    ];
  },
  async run(context) {
    await writeFile(path.join(context.root, "run-result.json"), JSON.stringify({ server: context.manifest.server }));
    return { launched: false, message: "fake: nothing connected" };
  },
  async package(context) {
    await mkdir(context.distDir, { recursive: true });
    const file = path.join(context.distDir, context.mobile.id + "-debug.apk");
    await writeFile(file, "apk");
    return { files: [file] };
  },
};
`;

async function installFakeShell(root) {
  const dir = path.join(root, "node_modules", "@farm.js", "mobile");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "@farm.js/mobile",
      type: "module",
      exports: { "./android": "./android.mjs", "./package.json": "./package.json" },
    }),
  );
  await writeFile(path.join(dir, "android.mjs"), FAKE_SHELL);
}

const LAYOUT =
  "export default function Layout({ children }) { return <html><body>{children}</body></html>; }";
const BUILD_CONFIG = `export default {
  telemetry: false,
  mobile: ({ command }) => ({
    id: "com.example.notes",
    server: command === "dev" ? undefined : "https://notes.example.com",
    tabs: [{ path: "/notes", title: "Notes", icon: "notes" }],
  }),
};`;

async function clientSources(dir) {
  const sources = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) {
      sources.push(await readFile(path.join(entry.parentPath, entry.name), "utf8"));
    }
  }
  return sources.join("\n");
}

test("--mobile excludes --desktop and --web, and --apk needs --mobile", async () => {
  const both = await runFarm(["build", "--mobile", "--desktop", "--root", testDir]);
  assert.notEqual(both.code, 0);
  assert.match(both.output, /Choose one platform: --desktop or --mobile/);
  const web = await runFarm(["dev", "--web", "--mobile", "--root", testDir]);
  assert.notEqual(web.code, 0);
  assert.match(web.output, /Choose one platform: --web or --mobile/);
  const apk = await runFarm(["build", "--apk", "--root", testDir]);
  assert.notEqual(apk.code, 0);
  assert.match(apk.output, /--apk needs --mobile/);
  const preset = await runFarm(["build", "--mobile", "--preset", "vercel", "--root", testDir]);
  assert.notEqual(preset.code, 0);
  assert.match(preset.output, /--preset is not available with --mobile/);
});

test("--mobile without @farm.js/mobile prints the install command", async (t) => {
  const root = await createApp(t, BUILD_CONFIG);
  const result = await runFarm(["build", "--mobile", "--root", root]);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /--mobile needs @farm\.js\/mobile, which is not installed/);
  assert.match(result.output, /npm install -D @farm\.js\/mobile/);
  assert.doesNotMatch(result.output, /\n\s+at /);
});

test("farm build --mobile fails on the block before building", async (t) => {
  const root = await createApp(
    t,
    `export default { mobile: { id: "com.example.notes", server: "http://10.0.2.2:3000" } };`,
  );
  await installFakeShell(root);
  const result = await runFarm(["build", "--mobile", "--root", root]);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /mobile \(os: android\): server must use https:\/\/ in a build/);
  await assert.rejects(stat(path.join(root, ".farm", "output", "mobile")));
});

test("farm build --mobile builds the mobile client apart from the web output and generates the project", async (t) => {
  const root = await createApp(t, BUILD_CONFIG);
  await writeFile(path.join(root, "src/app/layout.tsx"), LAYOUT);
  await installFakeShell(root);
  const mobileDir = path.join(root, ".farm", "output", "mobile");

  const result = await runFarm(["build", "--mobile", "--root", root], { VERCEL: "1" });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /\.farm\/output\/mobile\/android \(android project\)/);
  assert.match(result.output, /farm build --mobile --apk/);

  const routes = JSON.parse(await readFile(path.join(mobileDir, "farm-routes.json"), "utf8"));
  assert.equal(routes.server, "https://notes.example.com");
  assert.deepEqual(
    JSON.parse(await readFile(path.join(mobileDir, "android", "context.json"), "utf8")),
    {
      command: "build",
      basePath: "",
      id: "com.example.notes",
      server: "https://notes.example.com",
      projectDir: path.join(".farm", "output", "mobile", "android"),
    },
  );
  if (process.platform !== "win32") {
    assert.equal((await stat(path.join(mobileDir, "android", "gradlew"))).mode & 0o111, 0o111);
  }
  // The client build hands navigations to the shell; the web output was never written.
  const mobileClient = await clientSources(path.join(mobileDir, "www", "public"));
  assert.match(mobileClient, /farm:mobile-shell/);
  assert.match(mobileClient, /offerNavigation/);
  await assert.rejects(stat(path.join(root, ".farm", ".output")));
  await assert.rejects(stat(path.join(root, ".vercel")));

  const web = await runFarm(["build", "--root", root], { FARM_PLATFORM: "mobile" });
  assert.equal(web.code, 0, web.output);
  // A stale FARM_PLATFORM does not make a web build mobile.
  const webClient = await clientSources(path.join(root, ".farm", ".output", "public"));
  assert.doesNotMatch(webClient, /farm:mobile-shell|offerNavigation/);

  const apk = await runFarm(["build", "--mobile", "--apk", "--root", root]);
  assert.equal(apk.code, 0, apk.output);
  assert.match(apk.output, /📦 \.farm\/output\/mobile\/dist\/com\.example\.notes-debug\.apk/);
});

test("the mobile shell may not write outside its project", async (t) => {
  const root = await createApp(t, BUILD_CONFIG);
  await writeFile(path.join(root, "src/app/layout.tsx"), LAYOUT);
  await installFakeShell(root);
  const result = await runFarm(["build", "--mobile", "--root", root], { FAKE_SHELL_ESCAPE: "1" });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /tried to write \.\.\/escape\.txt outside/);
  await assert.rejects(stat(path.join(root, ".farm", "output", "mobile", "escape.txt")));
});

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForFile(file, child, output) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      return await readFile(file, "utf8");
    } catch {
      if (child.exitCode !== null) throw new Error(`farm dev exited early:\n${output()}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for ${file}:\n${output()}`);
}

test("farm dev --mobile points farm-routes.json at the dev server and serves a mobile client", async (t) => {
  const root = await createApp(t, BUILD_CONFIG);
  await writeFile(path.join(root, "src/app/layout.tsx"), LAYOUT);
  await installFakeShell(root);
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [cliBin, "dev", "--mobile", "--root", root, "--port", String(port)],
    {
      env: { ...process.env, FARM_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // Stopped before the app directory is removed, which createApp's cleanup does first.
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
  };
  try {
    await checkMobileDev(child, root, port);
  } finally {
    await stop();
  }
});

async function checkMobileDev(child, root, port) {
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  const run = JSON.parse(
    await waitForFile(path.join(root, "run-result.json"), child, () => output),
  );
  assert.deepEqual(run, { server: `http://10.0.2.2:${port}` });
  const routes = JSON.parse(
    await readFile(path.join(root, ".farm", "output", "mobile", "farm-routes.json"), "utf8"),
  );
  assert.equal(routes.server, `http://10.0.2.2:${port}`);
  assert.deepEqual(routes.tabs, [{ path: "/notes", title: "Notes", icon: "notes" }]);
  for (let attempt = 0; attempt < 50 && !output.includes("fake: nothing connected"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match(output, /fake: nothing connected/);

  // The emulator reaches the host loopback as 10.0.2.2, which maps to 127.0.0.1.
  const page = await fetch(`http://127.0.0.1:${port}/notes`);
  assert.equal(page.status, 200);
  const html = await page.text();
  const entry = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)]
    .map((match) => match[1])
    .find((src) => !src.includes("@vite/client"));
  assert.ok(entry, html);
  const client = await (await fetch(new URL(entry, `http://127.0.0.1:${port}`))).text();
  assert.match(client, /farm:mobile-shell/);
}
