import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "node:net";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, "..");
const cliBin = path.join(cliRoot, "bin", "farm.js");
const coreRoot = path.resolve(cliRoot, "..", "farm");

const APP_FILES = {
  "src/app/layout.tsx": `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  "src/app/page.tsx": `export default function Page() { return <main>desktop cli home</main>; }`,
  "src/desktop.ts": `export default {};`,
};

/**
 * A stand-in shell adapter. dev() plays the window: it presents the handshake token, follows the
 * cookie, records what it saw, and exits. package() writes one artifact.
 */
const FAKE_SHELL = `import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { request } from "node:http";

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = request(target, { headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

export default {
  name: "fake",
  runtime: process.env.FAKE_SHELL_RUNTIME || "bun",
  generateMain(context) {
    return [
      { path: "main.json", contents: JSON.stringify({
        name: context.desktop.name,
        basePath: context.basePath,
        serverDir: path.relative(context.root, context.serverDir),
        hooksFile: context.hooksFile && path.relative(context.root, context.hooksFile),
      }) },
      ...(process.env.FAKE_SHELL_ESCAPE ? [{ path: "../escape.txt", contents: "x" }] : []),
      ...(process.env.FAKE_SHELL_EXTRA ? [{ path: "nested/extra.txt", contents: "x" }] : []),
    ];
  },
  async dev(context) {
    const anonymous = await get(context.devUrl + "/");
    const handshake = await get(context.devUrl + "/__farm/desktop/handshake?t=" + context.handshakeToken);
    const cookie = String([handshake.headers["set-cookie"]].flat()[0]).split(";")[0];
    const home = await get(context.devUrl + "/", { cookie });
    await writeFile(path.join(context.root, "dev-result.json"), JSON.stringify({
      anonymous: anonymous.status,
      handshake: handshake.status,
      home: home.status,
      sawHome: home.body.includes("desktop cli home"),
      env: {
        devUrl: context.env.FARM_DESKTOP_DEV_URL === context.devUrl,
        secret: context.env.FARM_DESKTOP_SECRET === context.secret,
        dataDir: path.relative(context.root, context.env.FARM_DESKTOP_DATA_DIR),
      },
      generated: JSON.parse(await readFile(path.join(context.shellDir, "main.json"), "utf8")),
    }));
    return { exited: Promise.resolve(0), close: async () => {} };
  },
  async package(context) {
    await mkdir(context.distDir, { recursive: true });
    const file = path.join(context.distDir, context.desktop.name + ".app.txt");
    await writeFile(file, "packaged");
    return { files: [file] };
  },
};
`;

async function createApp(t, { config, shell = true } = {}) {
  // Inside the package, so node resolution finds the workspace's Vite and plugins.
  const root = await mkdtemp(path.join(cliRoot, ".tmp-desktop-"));
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
  if (shell) {
    const shellDir = path.join(root, "node_modules", "@farm.js", "desktop-fake");
    await mkdir(shellDir, { recursive: true });
    await writeFile(
      path.join(shellDir, "package.json"),
      JSON.stringify({
        name: "@farm.js/desktop-fake",
        type: "module",
        exports: { ".": "./index.mjs" },
      }),
    );
    await writeFile(path.join(shellDir, "index.mjs"), FAKE_SHELL);
  }
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "notes", version: "1.0.0", type: "module", private: true }),
  );
  await writeFile(
    path.join(root, "farm.config.ts"),
    config ?? `export default { telemetry: false, desktop: { name: "Notes", shell: "fake" } };`,
  );
  for (const [file, source] of Object.entries(APP_FILES)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), source);
  }
  return root;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
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

test("--web and --desktop are exclusive", async () => {
  const result = await runFarm(["build", "--web", "--desktop", "--root", testDir]);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Choose one platform: --web or --desktop/);
});

test("--desktop needs a desktop config entry", async (t) => {
  const root = await createApp(t, { config: "export default { telemetry: false };" });
  const result = await runFarm(["build", "--desktop", "--root", root]);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /--desktop needs a `desktop` entry in farm\.config\.ts/);
});

test("a missing shell adapter prints the install command", async (t) => {
  const root = await createApp(t, {
    shell: false,
    config: `export default { desktop: { name: "Notes" } };`,
  });
  const result = await runFarm(["build", "--desktop", "--root", root]);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /needs @farm\.js\/desktop-electrobun, which is not installed/);
  assert.match(result.output, /npm install -D @farm\.js\/desktop-electrobun/);
  // An expected failure: the message, no stack trace.
  assert.doesNotMatch(result.output, /at loadFarmDesktopShell/);
});

test("farm build --desktop builds the server, generates the shell, and packages it", async (t) => {
  const root = await createApp(t);
  const result = await runFarm(["build", "--desktop", "--root", root], {
    FAKE_SHELL_RUNTIME: "node",
    // A web-only environment variable must not move the desktop output.
    VERCEL: "1",
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /📦 \.farm\/output\/desktop\/dist\/Notes\.app\.txt/);

  const generated = JSON.parse(
    await readFile(path.join(root, ".farm", "output", "desktop", "shell", "main.json"), "utf8"),
  );
  assert.deepEqual(generated, {
    name: "Notes",
    basePath: "",
    serverDir: path.join(".farm", "output", "desktop", "server"),
    hooksFile: path.join("src", "desktop.ts"),
  });

  // The Node shell got the node-server output, whose entry exports start() for it.
  const entry = path.join(root, ".farm", "output", "desktop", "server", "server", "index.mjs");
  const source = await readFile(entry, "utf8");
  assert.match(source, /function start\(/);
  assert.match(source, /farm:ready /);
});

test("regenerating the shell drops stale files and keeps the shell's own caches", async (t) => {
  const root = await createApp(t);
  const shellDir = path.join(root, ".farm", "output", "desktop", "shell");
  assert.equal(
    (await runFarm(["build", "--desktop", "--root", root], { FAKE_SHELL_EXTRA: "1" })).code,
    0,
  );
  await readFile(path.join(shellDir, "nested", "extra.txt"), "utf8");
  await writeFile(path.join(shellDir, "toolchain-cache.txt"), "keep");
  assert.equal((await runFarm(["build", "--desktop", "--root", root])).code, 0);
  await assert.rejects(readFile(path.join(shellDir, "nested", "extra.txt"), "utf8"));
  assert.equal(await readFile(path.join(shellDir, "toolchain-cache.txt"), "utf8"), "keep");
  assert.deepEqual(
    JSON.parse(await readFile(path.join(shellDir, ".farm-generated.json"), "utf8")),
    ["main.json"],
  );
});

test("the shell may not write outside its directory", async (t) => {
  const root = await createApp(t);
  const result = await runFarm(["build", "--desktop", "--root", root], {
    FAKE_SHELL_ESCAPE: "1",
  });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /tried to write \.\.\/escape\.txt outside/);
});

const FUNCTION_CONFIG = (marker) => `import { appendFileSync } from "node:fs";
export default {
  telemetry: false,
  desktop: async ({ os, mode, command, profile, env, root }) => {
    appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ os, mode, command, profile, flag: env.FARM_TEST_FLAG, root }) + "\\n");
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { name: "Notes " + profile, id: "com.example.notes." + profile, shell: "fake" };
  },
};`;

test("--profile needs --desktop", async () => {
  const result = await runFarm(["build", "--profile", "beta", "--root", testDir]);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /--profile selects a desktop build profile; use it with --desktop/);
});

test("a function-valued desktop block is called once per build with the context", async (t) => {
  const marker = path.join(cliRoot, `.tmp-desktop-calls-${process.pid}-build.log`);
  t.after(() => rm(marker, { force: true }));
  const root = await createApp(t, { config: FUNCTION_CONFIG(marker) });
  const result = await runFarm(["build", "--desktop", "--profile", "beta", "--root", root], {
    FARM_TEST_FLAG: "on",
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /📦 \.farm\/output\/desktop\/dist\/Notes beta\.app\.txt/);
  const calls = (await readFile(marker, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  const { root: calledRoot, ...context } = calls[0];
  assert.deepEqual(context, {
    os:
      process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
    mode: "production",
    command: "build",
    profile: "beta",
    flag: "on",
  });
  assert.equal(calledRoot, root);
});

test("farm dev --desktop calls a function-valued block once per start", async (t) => {
  const marker = path.join(cliRoot, `.tmp-desktop-calls-${process.pid}-dev.log`);
  t.after(() => rm(marker, { force: true }));
  const root = await createApp(t, { config: FUNCTION_CONFIG(marker) });
  const result = await runFarm([
    "dev",
    "--desktop",
    "--root",
    root,
    "--port",
    String(await freePort()),
  ]);
  assert.equal(result.code, 0, result.output);
  const calls = (await readFile(marker, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    calls.map(({ mode, command, profile }) => ({ mode, command, profile })),
    [{ mode: "development", command: "dev", profile: "production" }],
  );
  const dev = JSON.parse(await readFile(path.join(root, "dev-result.json"), "utf8"));
  assert.equal(dev.home, 200);
  assert.equal(dev.generated.name, "Notes production");
});

test("a web build never calls a function-valued block and fails on a malformed static one", async (t) => {
  const marker = path.join(cliRoot, `.tmp-desktop-calls-${process.pid}-web.log`);
  t.after(() => rm(marker, { force: true }));
  const root = await createApp(t, { config: FUNCTION_CONFIG(marker) });
  const web = await runFarm(["build", "--root", root]);
  assert.equal(web.code, 0, web.output);
  await assert.rejects(readFile(marker, "utf8"));

  await writeFile(
    path.join(root, "farm.config.ts"),
    `export default { telemetry: false, desktop: { window: { width: "wide" } } };`,
  );
  const malformed = await runFarm(["build", "--root", root]);
  assert.notEqual(malformed.code, 0);
  assert.match(malformed.output, /desktop: window\.width must be a whole number/);
});

test("farm config inspect --desktop prints the resolved block for an OS and profile", async (t) => {
  const marker = path.join(cliRoot, `.tmp-desktop-calls-${process.pid}-inspect.log`);
  t.after(() => rm(marker, { force: true }));
  const root = await createApp(t, { config: FUNCTION_CONFIG(marker) });
  const result = await runFarm([
    "config",
    "inspect",
    "--desktop",
    "--os",
    "windows",
    "--profile",
    "beta",
    "--root",
    root,
  ]);
  assert.equal(result.code, 0, result.output);
  const printed = JSON.parse(result.output.slice(result.output.indexOf("{")));
  assert.deepEqual(printed, {
    context: { os: "windows", mode: "production", command: "build", profile: "beta" },
    desktop: {
      name: "Notes beta",
      id: "com.example.notes.beta",
      version: "1.0.0",
      window: { width: 1024, height: 768, title: "Notes beta" },
      shell: "fake",
      shellPackage: "@farm.js/desktop-fake",
    },
  });

  await writeFile(
    path.join(root, "farm.config.ts"),
    `export default { desktop: ({ os }) => ({ window: { height: os === "linux" ? 1 : 700 } }) };`,
  );
  const invalid = await runFarm([
    "config",
    "inspect",
    "--desktop",
    "--os",
    "linux",
    "--root",
    root,
  ]);
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.output, /desktop \(os: linux\): window\.height must be a whole number/);
});

test("farm dev --desktop guards the dev server and hands the shell a one-time handshake", async (t) => {
  const root = await createApp(t);
  const child = spawn(
    process.execPath,
    [cliBin, "dev", "--desktop", "--root", root, "--port", String(await freePort())],
    {
      env: { ...process.env, FARM_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 0, output);

  const result = JSON.parse(await readFile(path.join(root, "dev-result.json"), "utf8"));
  assert.deepEqual(result, {
    anonymous: 403,
    handshake: 303,
    home: 200,
    sawHome: true,
    env: { devUrl: true, secret: true, dataDir: path.join(".farm", "data", "desktop") },
    generated: {
      name: "Notes",
      basePath: "",
      serverDir: path.join(".farm", "output", "desktop", "server"),
      hooksFile: path.join("src", "desktop.ts"),
    },
  });
});
