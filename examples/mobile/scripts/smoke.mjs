// The mobile decisions Farm makes for this app, and the web build it stays.
//
// 1. `farm config inspect --mobile --report` for Android and iOS: every route's screen, source,
//    module, and presentation in farm-routes.json, and the analyzer's port and web decisions.
// 2. `farm build` (web) and `farm start`: every route answers, no native screen file, shell
//    bridge, or mobile block reaches the web output, and every `server` screen's native tree
//    converts without unsupported markup.
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobileDir = join(root, ".farm", "output", "mobile");
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function run(args, env = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn("farm", args, {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1", FARM_TELEMETRY_DISABLED: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolveRun(output) : reject(new Error(`farm ${args.join(" ")}:\n${output}`)),
    );
  });
}

async function readJson(file) {
  return JSON.parse(await readFile(join(mobileDir, file), "utf8"));
}

// ---- mobile decisions ---------------------------------------------------------------------

const table = await run(["config", "inspect", "--mobile", "--report"]);
const analyzed = /analyzed (\d+) modules \((\d+) parsed, (\d+) cached\) in (\d+) ms/.exec(table);
expect(analyzed, "the report prints analyzer stats");

const manifest = await readJson("farm-routes.json");
const report = await readJson("native-report.json");
const rule = (route) => manifest.rules.find((entry) => entry.route === route);
const row = (route) => report.routes.find((entry) => entry.route === route);

expect(
  JSON.stringify(manifest.tabs.map((tab) => tab.path)) === '["/","/notes","/settings"]',
  "three tabs: /, /notes, /settings",
);
expect(manifest.rules.at(-1)?.pattern === "^/", "a catch-all push rule comes last");
for (const entry of manifest.rules) {
  expect(
    ["web", "server", "native", "platform"].includes(entry.screen),
    `${entry.pattern} has a screen`,
  );
  const module = entry.route === "/" ? "app" : `app${entry.route}`;
  expect(
    entry.screen === "web" ? entry.module === undefined : entry.module === module,
    `${entry.route} module id`,
  );
}

// `native.auto: "on"`: the routes the analyzer proves render natively are `server` screens.
const SERVER = ["/", "/notes", "/notes/[id]", "/about", "/feed", "/navigation/step/[n]", "/docs/[...slug]"];
const ANDROID = {
  // The home page requires the native tier itself (`export const mobile`), so dev draws it too.
  "/": { presentation: "tab", tab: 0, screen: "server", source: "page" },
  "/notes": { presentation: "tab", tab: 1, screen: "server", source: "analyzer" },
  "/settings": { presentation: "tab", tab: 2, screen: "web", source: "default" },
  "/notes/[id]": { presentation: "push", screen: "server", source: "analyzer" },
  "/notes/new": { presentation: "modal", screen: "web", source: "default" },
  "/navigation/step/[n]": { presentation: "replace", screen: "server", source: "analyzer" },
  "/docs/[...slug]": { presentation: "push", screen: "server", source: "analyzer" },
  "/about": { presentation: "push", screen: "server", source: "analyzer" },
  "/feed": { presentation: "push", screen: "server", source: "analyzer" },
  "/navigation": { presentation: "push", screen: "web", source: "default" },
  // The analyzer's `port`: Farm generates its React Native screen.
  "/lab/packing": {
    presentation: "push",
    screen: "native",
    source: "analyzer",
    module: "app/lab/packing",
  },
  "/stations/[id]": { presentation: "push", screen: "web", source: "default" },
  "/map": { presentation: "push", screen: "native", source: "config", module: "app/map" },
  // A native-only route: page.native.tsx with no page.tsx (RFC 0004, 7.3).
  "/kit": { presentation: "push", screen: "native", source: "file", module: "app/kit", nativeOnly: true },
  "/camera": { presentation: "push", screen: "native", source: "file", module: "app/camera" },
  "/settings/device": {
    presentation: "push",
    screen: "platform",
    source: "file",
    module: "app/settings/device",
  },
};
for (const [route, expected] of Object.entries(ANDROID)) {
  const actual = rule(route);
  for (const [key, value] of Object.entries(expected)) {
    expect(actual?.[key] === value, `android ${route}.${key} is ${value}, got ${actual?.[key]}`);
  }
}
expect(row("/camera")?.file === "src/app/(styled)/camera/page.android.tsx", "android camera file");
expect(
  JSON.stringify(manifest.rules.filter((entry) => entry.screen === "server").map((entry) => entry.route).sort()) ===
    JSON.stringify([...SERVER].sort()),
  `the server screens are ${SERVER.join(", ")}`,
);
for (const route of SERVER) {
  expect(row(route)?.analysis?.tier === "native", `${route} is in the native tier`);
}
// Locale prefixes match the same rules.
const notesPattern = new RegExp(rule("/notes").pattern);
expect(notesPattern.test("/es/notes") && notesPattern.test("/notes"), "/es/notes is the notes tab");
expect(!new RegExp(rule("/notes/[id]").pattern).test("/es"), "/es is not a note");

expect(
  row("/lab/packing")?.file === ".farm/output/mobile/ports/app/lab/packing.port.tsx",
  "/lab/packing screen file is its port",
);
const packingPort = await readFile(
  join(mobileDir, "ports", "src", "app", "lab", "packing", "page.tsx"),
  "utf8",
).catch(() => "");
expect(packingPort.includes("<__FarmDom.input"), "/lab/packing port renames its elements");
expect(!packingPort.includes("@farm.js/core"), "/lab/packing port does not import @farm.js/core");
const packing = row("/lab/packing")?.analysis;
expect(packing?.decision === "port", "/lab/packing is a port");
expect(JSON.stringify(packing?.wins) === '["input","list"]', "/lab/packing wins: input, list");
const chart = row("/lab/chart")?.analysis;
expect(chart?.decision === "web", "/lab/chart stays web");
const chartRules = new Set(chart?.blockers.map((blocker) => `${blocker.rule} ${blocker.message}`));
for (const reason of [
  "browser-global window is a browser API",
  "unmapped-element <canvas> has no native mapping",
  "dom-ref a ref on <canvas> reaches the DOM",
  "unmapped-element <table> has no native mapping",
]) {
  expect(chartRules.has(reason), `/lab/chart blocker: ${reason}`);
}
expect(
  chart?.blockers.every((blocker) => blocker.file === "src/app/lab/chart/page.tsx" && blocker.line > 0),
  "/lab/chart blockers carry file:line",
);
expect(
  row("/stations/[id]")?.analysis?.blockers[0]?.rule === "programmatic-route",
  "/stations/[id] is programmatic",
);
expect(
  row("/notes/new")?.analysis?.blockers.some((blocker) => blocker.message === "<form> has no native mapping"),
  "/notes/new is blocked by its form",
);

await run(["config", "inspect", "--mobile", "--os", "ios", "--report"]);
const ios = await readJson("farm-routes.json");
const iosRule = (route) => ios.rules.find((entry) => entry.route === route);
expect(iosRule("/map")?.screen === "web" && iosRule("/map")?.source === "config", "ios /map is web");
expect(iosRule("/camera")?.screen === "native", "ios /camera is native");
expect(
  iosRule("/kit")?.screen === "native" && iosRule("/kit")?.nativeOnly === true,
  "ios /kit is native-only",
);
expect((await readJson("native-report.json")).routes.find((entry) => entry.route === "/camera")?.file === "src/app/(styled)/camera/page.native.tsx", "ios camera file");
// page.kt is Android only; on iOS its page.tsx passes the native-tier check.
expect(iosRule("/settings/device")?.screen === "server", "ios /settings/device is a server screen");
for (const route of SERVER) expect(iosRule(route)?.screen === "server", `ios ${route} is a server screen`);
// iOS does not host React Native yet, so the port stays web there.
expect(iosRule("/lab/packing")?.screen === "web", "ios /lab/packing is web");

// ---- web build ------------------------------------------------------------------------------

await run(["build"]);
const leaks = [
  "MapScreen",
  "KitScreen",
  "CameraScreen",
  "AndroidCameraScreen",
  "DeviceScreen",
  "registerFarmScreens",
  "serverFetch",
  "farm:mobile-shell",
  "offerNavigation",
  "__farmBridge",
  "dev.farmjs.examples.fieldnotes",
  "screenOpenMs",
];
async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(file);
    else if (/\.(?:m?js|html|json)$/.test(entry.name)) yield file;
  }
}
// The mobile client entry carries the shell bridge on purpose: the server sends it only to
// documents a shell asks for (checked below), never to a browser.
const mobileClient = /^farm-mobile-client-h[0-9a-f]+\.js$/;
for await (const file of files(join(root, ".farm", ".output"))) {
  if (mobileClient.test(file.split(/[\\/]/).at(-1))) continue;
  const source = await readFile(file, "utf8");
  // `native` from @farm.js/core/native (the /settings device card) looks for the shell's bridge
  // on purpose, and finds none in a browser.
  const nativeProxy = source.includes("NativeUnavailableError");
  for (const leak of leaks) {
    if (nativeProxy && leak === "__farmBridge") continue;
    expect(!source.includes(leak), `${leak} is in the web output: ${file}`);
  }
}

const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn("farm", ["start", "--port", String(port), "--host", "127.0.0.1"], {
  cwd: root,
  env: { ...process.env, NO_COLOR: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk));
server.stderr.on("data", (chunk) => (serverOutput += chunk));
try {
  await waitFor(`${origin}/`, 30_000);
  const PAGES = {
    "/": "Field notes",
    "/es": "Notas de campo",
    "/notes/1": "Creek crossing",
    "/notes/new": "New note",
    "/docs/guide/tabs": "Tabs",
    "/stations/north": "North ridge",
    "/map": "Map",
    "/camera": "Camera",
    "/settings/device": "Device",
    "/navigation/step/2": `data-testid="step"`,
    "/lab/packing": "Packing list",
    "/lab/chart": "Temperature",
  };
  for (const [path, text] of Object.entries(PAGES)) {
    const response = await fetch(origin + path);
    const html = await response.text();
    expect(response.status === 200 && html.includes(text), `GET ${path} renders "${text}"`);
  }
  // What the shell fetches for a `server` screen: the page as a native tree.
  const TREES = {
    "/": "Field notes",
    "/notes": "Creek crossing",
    "/notes/1": "Creek crossing",
    "/about": "About",
    "/feed": "Observation 240",
    "/navigation/step/2": "Step 2",
    "/docs/guide/tabs": "Tabs",
  };
  for (const [path, text] of Object.entries(TREES)) {
    const response = await fetch(origin + path, {
      headers: { accept: "application/vnd.farm.native+json" },
    });
    const tree = response.ok ? await response.json() : undefined;
    expect(
      response.headers.get("content-type")?.startsWith("application/vnd.farm.native+json"),
      `GET ${path} answers the native tree`,
    );
    expect(
      JSON.stringify(tree?.unsupported) === "[]",
      `${path} converts natively, unsupported: ${JSON.stringify(tree?.unsupported)}`,
    );
    expect(JSON.stringify(tree?.root ?? null).includes(text), `the ${path} tree has "${text}"`);
  }
  const browserDocument = await (await fetch(`${origin}/notes`)).text();
  const shellDocument = await (
    await fetch(`${origin}/notes`, { headers: { "x-farm-shell": "android" } })
  ).text();
  expect(!browserDocument.includes("farm-mobile-client"), "a browser never loads the mobile client");
  expect(shellDocument.includes("/farm-mobile-client-h"), "a shell document loads the mobile client");
  const feed = await (await fetch(`${origin}/feed`)).text();
  expect((feed.match(/Observation \d+/g) ?? []).length === 240, "/feed renders 240 rows");
  expect((await fetch(`${origin}/stations/nope`)).status === 404, "an unknown station is a 404");
  // A native-only route has no web page: the web deployment answers it like any unknown path.
  expect((await fetch(`${origin}/kit`)).status === 404, "a native-only route is not a web route");
  // What the /map native screen lists.
  const stations = await (await fetch(`${origin}/api/stations`)).json();
  expect(
    Array.isArray(stations) && stations.map((station) => station.id).join() === "north,lake,pass",
    "GET /api/stations lists the stations",
  );
  const created = await fetch(`${origin}/api/notes`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ title: "Smoke", body: "from the smoke test" }),
  });
  const note = await created.json();
  expect(created.ok && note.title === "Smoke", "POST /api/notes runs the server function");
  const page = await (await fetch(`${origin}/notes/${note.id}`)).text();
  expect(page.includes("Smoke"), "the new note renders");
} finally {
  server.kill("SIGTERM");
}

if (failures.length > 0) {
  console.error(serverOutput.slice(-4000));
  console.error(`\n${failures.length} failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `Mobile decisions and the web build check out (analyzer: ${analyzed?.[1]} modules in ${analyzed?.[4]} ms).`,
);

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`farm start exited:\n${serverOutput}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`${url} was not ready:\n${serverOutput}`);
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolvePort(address.port));
    });
  });
}
