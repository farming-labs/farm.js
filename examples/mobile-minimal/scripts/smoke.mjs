// The mobile decisions Farm makes for this app: the portable routes reach the native tier, the
// about page stays web for its stated reason, and nothing needs a native file to say so.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobileDir = join(root, ".farm", "output", "mobile");
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn("farm", args, {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1", FARM_TELEMETRY_DISABLED: "1" },
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

await run(["config", "inspect", "--mobile", "--report"]);
const manifest = JSON.parse(await readFile(join(mobileDir, "farm-routes.json"), "utf8"));
const report = JSON.parse(await readFile(join(mobileDir, "native-report.json"), "utf8"));
const rule = (route) => manifest.rules.find((entry) => entry.route === route);
const row = (route) => report.routes.find((entry) => entry.route === route);

expect(
  JSON.stringify(manifest.tabs.map((tab) => tab.path)) === '["/","/about"]',
  "two tabs: / and /about",
);
expect(rule("/")?.screen === "server", "the home page is a server screen (native tier)");
expect(
  rule("/trails/[id]")?.screen === "server",
  "the dynamic trail page is a server screen (native tier)",
);
expect(rule("/about")?.screen === "web", "the about page stays a web screen");
expect(
  (row("/about")?.analysis?.blockers ?? []).some((blocker) =>
    blocker.message.includes("<svg> has no native mapping"),
  ),
  "the report names why /about is not native",
);

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Trail Guide's mobile decisions are as documented.");
