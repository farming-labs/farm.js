import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
  "src/app/feed/page.tsx": PAGE,
  "src/app/feed/page.native.tsx": PAGE,
  "src/app/feed/page.android.tsx": PAGE,
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
    native: { routes: { "/notes/[id]": { screen: "web", ios: "native" } } },
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
    native: {
      engine: "react-native",
      auto: "report",
      routes: { "/notes/[id]": { screen: "web", ios: "native" } },
      islands: [],
      prefetch: "intent",
      budgets: {},
    },
    shells: false,
  });
  // Every route's tier on this OS and what decided it.
  assert.deepEqual(printed.screens, {
    "/": { screen: "web", source: "default", presentation: "push" },
    "/feed": {
      screen: "native",
      source: "file",
      file: "src/app/feed/page.native.tsx",
      module: "app/feed",
      presentation: "push",
    },
    "/notes": { screen: "web", source: "default", presentation: "push" },
    "/notes/[id]": {
      screen: "web",
      source: "config",
      requested: "native",
      presentation: "push",
    },
    "/notes/new": { screen: "web", source: "default", presentation: "modal" },
    "/settings": { screen: "web", source: "default", presentation: "push" },
  });
  assert.equal(printed.warnings.length, 1);
  assert.match(printed.warnings[0], /native\.routes\["\/notes\/\[id\]"\]\.ios is "native"/);
  const web = { screen: "web", source: "default" };
  assert.deepEqual(printed.routes.rules, [
    { route: "/notes/new", pattern: "^/notes/new/?$", presentation: "modal", ...web },
    {
      route: "/notes/[id]",
      pattern: "^/notes/[^/]+/?$",
      presentation: "push",
      screen: "web",
      source: "config",
    },
    {
      route: "/feed",
      pattern: "^/feed/?$",
      presentation: "push",
      screen: "native",
      source: "file",
      module: "app/feed",
    },
    { route: "/notes", pattern: "^/notes/?$", presentation: "tab", tab: 0, ...web },
    { route: "/settings", pattern: "^/settings/?$", presentation: "tab", tab: 1, ...web },
    { route: "/", pattern: "^/?$", presentation: "push", ...web },
    { pattern: "^/", presentation: "push", screen: "web" },
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
  // On Android the OS file wins over page.native.tsx, and config keeps /notes/[id] web.
  assert.equal(printed.screens["/feed"].file, "src/app/feed/page.android.tsx");
  assert.deepEqual(printed.screens["/notes/[id]"], {
    screen: "web",
    source: "config",
    presentation: "push",
  });
  assert.equal(printed.warnings, undefined);

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

const OS = "android";

export default {
  os: OS,
  generate(context) {
    return [
      { path: "context.json", contents: JSON.stringify({
        command: context.command,
        basePath: context.basePath,
        id: context.mobile.id,
        server: context.manifest.server,
        projectDir: path.relative(context.root, context.projectDir),
        native: context.native ?? null,
        assets: context.assets
          ? { dir: path.relative(context.root, context.assets.dir), entry: context.assets.entry, files: context.assets.files }
          : null,
      }) },
      { path: "gradlew", contents: "#!/bin/sh\\n", executable: true },
      ...(context.shells ? [{ path: "shells.json", contents: JSON.stringify(context.shells) }] : []),
      ...(process.env.FAKE_SHELL_ESCAPE ? [{ path: "../escape.txt", contents: "x" }] : []),
    ];
  },
  async run(context) {
    await writeFile(path.join(context.root, "run-result.json"), JSON.stringify({ server: context.manifest.server }));
    return { launched: false, message: "fake: nothing connected" };
  },
  async package(context) {
    // Like the iOS shell without Xcode: nothing built, and what to do instead.
    if (OS === "ios") return { files: [], message: "fake: install Xcode" };
    await mkdir(context.distDir, { recursive: true });
    const file = path.join(context.distDir, context.mobile.id + "-debug.apk");
    await writeFile(file, "apk");
    return { files: [file] };
  },
};
`;

/**
 * A stand-in for @farm.js/native/build: records what the CLI asked for and writes a bytecode
 * file, without React Native.
 */
const FAKE_NATIVE_BUILD = `import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const reactNative = { version: "0.88.1", hermesVersion: "260318099.0.5" };

async function record(options, name) {
  await mkdir(options.outDir, { recursive: true });
  await writeFile(path.join(options.root, name), JSON.stringify({
    outDir: path.relative(options.root, options.outDir),
    basePath: options.basePath,
    screens: options.screens.map((screen) => ({ ...screen, file: path.relative(options.root, screen.file) })),
  }));
}

export async function buildFarmNativeScreens(options) {
  await record(options, "native-build.json");
  const bundle = path.join(options.outDir, "index.android.hbc");
  await writeFile(bundle, "hbc");
  return { reactNative, bundle, jsBytes: 2048, bytecodeBytes: 3072, bundleMs: 1, hermesMs: 1 };
}

export async function startFarmNativeDevServer(options) {
  await record(options, "native-dev.json");
  return { reactNative, port: options.port, mainModule: ".farm/output/mobile/native/index", close: async () => {} };
}
`;

async function installFakeNativeBuild(root) {
  const dir = path.join(root, "node_modules", "@farm.js", "native");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "@farm.js/native",
      type: "module",
      exports: { "./build": "./build.mjs", "./package.json": "./package.json" },
    }),
  );
  await writeFile(path.join(dir, "build.mjs"), FAKE_NATIVE_BUILD);
}

async function installFakeShell(root) {
  const dir = path.join(root, "node_modules", "@farm.js", "mobile");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "@farm.js/mobile",
      type: "module",
      exports: {
        "./android": "./android.mjs",
        "./ios": "./ios.mjs",
        "./package.json": "./package.json",
      },
    }),
  );
  await writeFile(path.join(dir, "android.mjs"), FAKE_SHELL);
  await writeFile(
    path.join(dir, "ios.mjs"),
    FAKE_SHELL.replace('const OS = "android";', 'const OS = "ios";'),
  );
}

const LAYOUT =
  "export default function Layout({ children }) { return <html><body>{children}</body></html>; }";
const BUILD_CONFIG = `export default {
  telemetry: false,
  mobile: ({ command }) => ({
    id: "com.example.notes",
    server: command === "dev" ? undefined : "https://notes.example.com",
    tabs: [{ path: "/notes", title: "Notes", icon: "notes" }],
    native: { routes: { "/notes": { screen: "native" } } },
  }),
};`;

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
  const os = await runFarm(["build", "--os", "ios", "--root", testDir]);
  assert.notEqual(os.code, 0);
  assert.match(os.output, /--os needs --mobile/);
  const devOs = await runFarm(["dev", "--os", "ios", "--root", testDir]);
  assert.notEqual(devOs.code, 0);
  assert.match(devOs.output, /--os needs --mobile/);
  const unknown = await runFarm(["build", "--mobile", "--os", "windows", "--root", testDir]);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.output, /--os must be android or ios, not "windows"/);
  assert.doesNotMatch(unknown.output, /\n\s+at /);
  const iosApk = await runFarm(["build", "--mobile", "--os", "ios", "--apk", "--root", testDir]);
  assert.notEqual(iosApk.code, 0);
  assert.match(iosApk.output, /--apk builds the Android app; it is not available with --os ios/);
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
  await installFakeNativeBuild(root);
  const mobileDir = path.join(root, ".farm", "output", "mobile");

  const result = await runFarm(["build", "--mobile", "--root", root], { VERCEL: "1" });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /\.farm\/output\/mobile\/android \(android project\)/);
  assert.match(result.output, /farm build --mobile --apk/);
  // The config asks for a native "/notes"; the analyzer proves the page needs no JavaScript, so
  // the shell draws it from the page the server renders, with no warning.
  assert.match(result.output, /\/notes\s+server\s+native\s/);
  assert.doesNotMatch(result.output, /Farm cannot port pages yet/);
  // native.auto defaults to "report": the build prints the analyzer table and writes the report.
  assert.match(result.output, /route\s+screen\s+tier\s+decision\s+mapped\s+portable\s+reason/);
  assert.match(result.output, /full report: \.farm\/output\/mobile\/native-report\.json/);
  assert.equal(
    JSON.parse(await readFile(path.join(mobileDir, "native-report.json"), "utf8")).auto,
    "report",
  );

  const routes = JSON.parse(await readFile(path.join(mobileDir, "farm-routes.json"), "utf8"));
  assert.equal(routes.server, "https://notes.example.com");
  // The mobile client the build added, for the shell to bundle.
  const mobileClient = JSON.parse(
    await readFile(path.join(root, ".farm", "mobile-client.json"), "utf8"),
  );
  assert.match(mobileClient.entry, /^\/farm-mobile-client-h[0-9a-f]{8,}\.js$/);
  assert.match(
    result.output,
    new RegExp(
      `Mobile client ${mobileClient.entry.replace(/[.]/g, "\\.")}: \\d+ files bundled into the app`,
    ),
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(mobileDir, "android", "context.json"), "utf8")),
    {
      command: "build",
      basePath: "",
      id: "com.example.notes",
      server: "https://notes.example.com",
      projectDir: path.join(".farm", "output", "mobile", "android"),
      // /feed has page.android.tsx: its screen is built into the app as Hermes bytecode.
      native: {
        engine: "react-native",
        reactNativeVersion: "0.88.1",
        hermesVersion: "260318099.0.5",
        modules: ["app/feed"],
        bundle: path.join(mobileDir, "native", "index.android.hbc"),
      },
      assets: {
        dir: path.join(".farm", "client"),
        entry: mobileClient.entry,
        files: mobileClient.files,
      },
    },
  );
  assert.ok(mobileClient.files.includes(mobileClient.entry));
  for (const file of mobileClient.files) {
    await stat(path.join(root, ".farm", "client", file));
    // Deployed like any client file.
    await stat(path.join(mobileDir, "www", "public", file));
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "native-build.json"), "utf8")), {
    outDir: path.join(".farm", "output", "mobile", "native"),
    basePath: "",
    screens: [
      {
        module: "app/feed",
        route: "/feed",
        file: path.join("src", "app", "feed", "page.android.tsx"),
      },
    ],
  });
  assert.match(
    result.output,
    /React Native 0\.88\.1: 1 native screen, 2\.0 KB JS, 3\.0 KB Hermes bytecode/,
  );
  if (process.platform !== "win32") {
    assert.equal((await stat(path.join(mobileDir, "android", "gradlew"))).mode & 0o111, 0o111);
  }
  // The mobile client hands navigations to the shell, the web client does not; the web output
  // was never written.
  const split = async (dir) => {
    const mobile = [];
    const web = [];
    for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
      const file = path.join(entry.parentPath, entry.name);
      const url = `/${path.relative(dir, file).split(path.sep).join("/")}`;
      (mobileClient.files.includes(url) ? mobile : web).push(await readFile(file, "utf8"));
    }
    return { mobile: mobile.join("\n"), web: web.join("\n") };
  };
  const built = await split(path.join(mobileDir, "www", "public"));
  assert.match(built.mobile, /farm:mobile-shell/);
  assert.match(built.mobile, /offerNavigation/);
  assert.doesNotMatch(built.web, /farm:mobile-shell|offerNavigation/);
  await assert.rejects(stat(path.join(root, ".farm", ".output")));
  await assert.rejects(stat(path.join(root, ".vercel")));

  const web = await runFarm(["build", "--root", root], { FARM_PLATFORM: "mobile" });
  assert.equal(web.code, 0, web.output);
  // A web deployment has the same mobile client, and a stale FARM_PLATFORM does not make its web
  // client mobile.
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, ".farm", "mobile-client.json"), "utf8")),
    mobileClient,
  );
  const deployed = await split(path.join(root, ".farm", ".output", "public"));
  assert.match(deployed.mobile, /farm:mobile-shell/);
  assert.doesNotMatch(deployed.web, /farm:mobile-shell|offerNavigation/);

  const apk = await runFarm(["build", "--mobile", "--apk", "--root", root]);
  assert.equal(apk.code, 0, apk.output);
  assert.match(apk.output, /📦 \.farm\/output\/mobile\/dist\/com\.example\.notes-debug\.apk/);
});

/**
 * Every file of a Node build output by its path, as a content hash. Nitro's build date and the
 * dates in its public asset table differ from build to build, so those two files count by name.
 * The asset table lives in the built server, which `node-server` emits beside the compile-cache
 * launcher; `server/index.mjs` is that launcher and is hashed, so a build stays reproducible.
 * The text of the app's own code is kept to show where two builds differ.
 */
async function snapshot(dir) {
  const files = {};
  const texts = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const name = path.relative(dir, file).split(path.sep).join("/");
    if (["nitro.json", "server/farm-server.mjs"].includes(name)) {
      files[name] = "dated";
      continue;
    }
    const bytes = await readFile(file);
    files[name] = createHash("sha256").update(bytes).digest("hex");
    if (!name.includes("node_modules/") && /\.(?:m?js|json)$/.test(name)) {
      texts[name] = bytes.toString("utf8");
    }
  }
  return { files, texts };
}

/** Where two builds' files first differ, with some text around it. */
function describeBuildDifference(actual, expected) {
  const names = new Set([...Object.keys(actual.files), ...Object.keys(expected.files)]);
  const lines = [];
  for (const name of [...names].sort()) {
    if (actual.files[name] === expected.files[name]) continue;
    const a = actual.texts[name];
    const b = expected.texts[name];
    if (a === undefined || b === undefined) {
      lines.push(
        `${name}: ${actual.files[name] ?? "missing"} vs ${expected.files[name] ?? "missing"}`,
      );
      continue;
    }
    let at = 0;
    while (at < a.length && a[at] === b[at]) at++;
    const around = (text) => JSON.stringify(text.slice(Math.max(0, at - 160), at + 160));
    lines.push(`${name} differs at ${at}:\n  with:    ${around(a)}\n  without: ${around(b)}`);
  }
  return lines.join("\n");
}

test("mobile.shells renders page shells in farm build --mobile and leaves farm build as it was", async (t) => {
  const root = await createApp(t, BUILD_CONFIG);
  await writeFile(path.join(root, "src/app/layout.tsx"), LAYOUT);
  await writeFile(
    path.join(root, "src/app/notes/loading.tsx"),
    'export default function Loading() { return <p className="skeleton">Loading notes</p>; }',
  );
  await installFakeShell(root);
  await installFakeNativeBuild(root);
  // A fixed build id: a web build is otherwise only ever new by its id and Nitro's dates.
  const config = (shells) =>
    BUILD_CONFIG.replace(
      "telemetry: false,",
      'telemetry: false,\n  generateBuildId: () => "fixed",',
    ).replace('server: command === "dev"', `shells: ${shells},\n    server: command === "dev"`);

  // The web build: the same bytes with and without shells.
  await writeFile(path.join(root, "farm.config.ts"), config(false));
  const plain = await runFarm(["build", "--root", root]);
  assert.equal(plain.code, 0, plain.output);
  const without = await snapshot(path.join(root, ".farm", ".output"));
  await writeFile(path.join(root, "farm.config.ts"), config(true));
  const withShells = await runFarm(["build", "--root", root]);
  assert.equal(withShells.code, 0, withShells.output);
  const withShellsBuild = await snapshot(path.join(root, ".farm", ".output"));
  assert.deepEqual(
    withShellsBuild.files,
    without.files,
    describeBuildDifference(withShellsBuild, without),
  );
  assert.doesNotMatch(withShells.output, /Page shells/);

  const mobile = await runFarm(["build", "--mobile", "--root", root]);
  assert.equal(mobile.code, 0, mobile.output);
  // The /notes routes share notes/loading.tsx and one file; the other routes have no loading file
  // and are not named.
  assert.match(mobile.output, /Page shells: 3 routes in 1 file \(3 without one\)/);
  assert.doesNotMatch(mobile.output, /Page shell \//);
  const mobileDir = path.join(root, ".farm", "output", "mobile");
  const routes = JSON.parse(await readFile(path.join(mobileDir, "farm-routes.json"), "utf8"));
  const mobileClient = JSON.parse(
    await readFile(path.join(root, ".farm", "mobile-client.json"), "utf8"),
  );
  const [file] = Object.values(routes.shells.routes);
  assert.match(file, /^[0-9a-f]{16}\.html$/);
  assert.deepEqual(routes.shells, {
    client: mobileClient.entry,
    routes: { "/notes": file, "/notes/[id]": file, "/notes/new": file },
  });
  // The shell package gets the files, named by their content: no scripts, the layout around the
  // loading state, and the marker app CSS can use.
  const shells = JSON.parse(await readFile(path.join(mobileDir, "android", "shells.json"), "utf8"));
  assert.deepEqual(Object.keys(shells.files), [file]);
  const html = shells.files[file];
  assert.equal(`${createHash("sha256").update(html).digest("hex").slice(0, 16)}.html`, file);
  assert.match(html, /<html data-farm-page-shell>/);
  assert.match(html, /<p class="skeleton">Loading notes<\/p>/);
  assert.doesNotMatch(html, /<script|modulepreload|127\.0\.0\.1|canonical/i);
});

test("farm build --mobile --os ios generates the iOS project and reports what the shell could not build", async (t) => {
  const root = await createApp(t, BUILD_CONFIG);
  await writeFile(path.join(root, "src/app/layout.tsx"), LAYOUT);
  await installFakeShell(root);
  const mobileDir = path.join(root, ".farm", "output", "mobile");

  const result = await runFarm(["build", "--mobile", "--os", "ios", "--root", root]);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /\.farm\/output\/mobile\/ios \(ios project\)/);
  // The iOS shell packages on every build; without Xcode it says what to install.
  assert.match(result.output, /fake: install Xcode/);
  assert.doesNotMatch(result.output, /--apk/);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(mobileDir, "ios", "context.json"), "utf8")),
    {
      command: "build",
      basePath: "",
      id: "com.example.notes",
      server: "https://notes.example.com",
      projectDir: path.join(".farm", "output", "mobile", "ios"),
      // The iOS shell has no React Native host yet, so /feed is a placeholder there.
      native: null,
      // The shell decides what to bundle; the real iOS shell loads them from the server.
      assets: {
        dir: path.join(".farm", "client"),
        entry: JSON.parse(await readFile(path.join(root, ".farm", "mobile-client.json"), "utf8"))
          .entry,
        files: JSON.parse(await readFile(path.join(root, ".farm", "mobile-client.json"), "utf8"))
          .files,
      },
    },
  );
  assert.match(
    result.output,
    /Mobile client \/farm-mobile-client-h[0-9a-f]+\.js: loaded from the server/,
  );
  await assert.rejects(stat(path.join(mobileDir, "android")));
  // Resolved for iOS: page.android.tsx is not the /feed screen there.
  const routes = JSON.parse(await readFile(path.join(mobileDir, "farm-routes.json"), "utf8"));
  const feed = routes.rules.find((rule) => rule.route === "/feed");
  assert.equal(feed.screen, "native");
  assert.equal(feed.module, "app/feed");
});

test("the mobile shell may not write outside its project", async (t) => {
  const root = await createApp(t, BUILD_CONFIG);
  await writeFile(path.join(root, "src/app/layout.tsx"), LAYOUT);
  await installFakeShell(root);
  await installFakeNativeBuild(root);
  const result = await runFarm(["build", "--mobile", "--root", root], { FAKE_SHELL_ESCAPE: "1" });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /tried to write \.\.\/escape\.txt outside/);
  await assert.rejects(stat(path.join(root, ".farm", "output", "mobile", "escape.txt")));
});

test("an app without native screens never loads @farm.js/native and gets no React Native", async (t) => {
  const root = await createApp(t, BUILD_CONFIG);
  await writeFile(path.join(root, "src/app/layout.tsx"), LAYOUT);
  await rm(path.join(root, "src/app/feed/page.native.tsx"));
  await rm(path.join(root, "src/app/feed/page.android.tsx"));
  await installFakeShell(root);
  // Not installed: a build that needed it would fail with the install command.
  const result = await runFarm(["build", "--mobile", "--root", root]);
  assert.equal(result.code, 0, result.output);
  assert.doesNotMatch(result.output, /React Native|@farm\.js\/native/);
  const context = JSON.parse(
    await readFile(path.join(root, ".farm", "output", "mobile", "android", "context.json"), "utf8"),
  );
  assert.equal(context.native, null);
  await assert.rejects(stat(path.join(root, ".farm", "output", "mobile", "native")));
});

test("a native screen without @farm.js/native prints the install command", async (t) => {
  const root = await createApp(t, BUILD_CONFIG);
  await writeFile(path.join(root, "src/app/layout.tsx"), LAYOUT);
  await installFakeShell(root);
  const result = await runFarm(["build", "--mobile", "--root", root]);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /page\.native\.tsx screens need @farm\.js\/native, React Native/);
  assert.match(
    result.output,
    /@farm\.js\/native react-native@\^0\.88 @react-native\/metro-config@\^0\.88/,
  );
  assert.doesNotMatch(result.output, /\n\s+at /);
  // Checked before the client build.
  await assert.rejects(stat(path.join(root, ".farm", "output", "mobile", "www")));
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
      const contents = await readFile(file, "utf8");
      // The fake shell may still be writing it (seen on Windows).
      JSON.parse(contents);
      return contents;
    } catch {
      // Not there or not complete yet.
    }
    if (child.exitCode !== null) throw new Error(`farm dev exited early:\n${output()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${file}:\n${output()}`);
}

for (const os of ["android", "ios"]) {
  test(`farm dev --mobile --os ${os} points farm-routes.json at the dev server and serves a mobile client`, async (t) => {
    await checkMobileDevServer(t, os);
  });
}

async function checkMobileDevServer(t, os) {
  const root = await createApp(t, BUILD_CONFIG);
  await writeFile(path.join(root, "src/app/layout.tsx"), LAYOUT);
  await installFakeShell(root);
  await installFakeNativeBuild(root);
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [cliBin, "dev", "--mobile", "--os", os, "--root", root, "--port", String(port)],
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
    await checkMobileDev(child, root, port, os);
  } finally {
    await stop();
  }
}

async function checkMobileDev(child, root, port, os) {
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  const run = JSON.parse(
    await waitForFile(path.join(root, "run-result.json"), child, () => output),
  );
  // The Android emulator reaches the host's loopback as 10.0.2.2; an iOS simulator shares it.
  const server = os === "ios" ? `http://localhost:${port}` : `http://10.0.2.2:${port}`;
  assert.deepEqual(run, { server });
  const routes = JSON.parse(
    await readFile(path.join(root, ".farm", "output", "mobile", "farm-routes.json"), "utf8"),
  );
  assert.equal(routes.server, server);
  await stat(path.join(root, ".farm", "output", "mobile", os, "context.json"));
  assert.deepEqual(routes.tabs, [{ path: "/notes", title: "Notes", icon: "notes" }]);
  for (let attempt = 0; attempt < 50 && !output.includes("fake: nothing connected"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match(output, /fake: nothing connected/);
  const native = JSON.parse(
    await readFile(path.join(root, ".farm", "output", "mobile", os, "context.json"), "utf8"),
  ).native;
  if (os === "ios") {
    // No React Native host on iOS yet: Metro never starts and /feed stays a placeholder.
    assert.equal(native, null);
    assert.doesNotMatch(output, /React Native/);
    await assert.rejects(stat(path.join(root, "native-dev.json")));
  } else {
    // Native screens load from Metro in dev, never from a bundled file.
    assert.equal(native.bundle, undefined);
    assert.equal(native.devServer.mainModule, ".farm/output/mobile/native/index");
    assert.ok(native.devServer.port >= 8081, JSON.stringify(native));
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, "native-dev.json"), "utf8")).screens.map(
        (screen) => screen.module,
      ),
      ["app/feed"],
    );
  }

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

test("farm config inspect --mobile --report prints the analyzer table and writes native-report.json", async (t) => {
  const root = await createApp(t, CONFIG);
  await writeFile(
    path.join(root, "src/app/notes/page.tsx"),
    `export default function Notes() {
  const notes = ["a", "b"];
  return <ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul>;
}`,
  );
  await writeFile(
    path.join(root, "src/app/notes/new/page.tsx"),
    'export default function New() { return <form><input type="file" /></form>; }',
  );
  const result = await runFarm(["config", "inspect", "--mobile", "--report", "--root", root]);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /route\s+screen\s+tier\s+decision\s+mapped\s+portable\s+reason/);
  assert.match(
    result.output,
    /\/notes\s+web\s+native\s+port\s+2\/2\s+100%\s+renders natively, no JavaScript on the device/,
  );
  assert.match(
    result.output,
    /\/notes\/new\s+web\s+web\s+web\s+1\/2\s+50%\s+src\/app\/notes\/new\/page\.tsx:1:40 <form> has no native mapping \(\+1 more\)/,
  );
  assert.match(result.output, /\/feed\s+native\s+-\s+-\s+src\/app\/feed\/page\.android\.tsx/);
  assert.match(result.output, /full report: \.farm\/output\/mobile\/native-report\.json/);
  const report = JSON.parse(
    await readFile(path.join(root, ".farm/output/mobile/native-report.json"), "utf8"),
  );
  assert.equal(report.auto, "report");
  assert.deepEqual(
    report.routes
      .find((entry) => entry.route === "/notes/new")
      .analysis.blockers.map((blocker) => blocker.rule),
    ["unmapped-element", "unmapped-element"],
  );

  const wrong = await runFarm(["config", "inspect", "--report", "--root", root]);
  assert.notEqual(wrong.code, 0);
  assert.match(wrong.output, /--report needs --mobile/);
});
