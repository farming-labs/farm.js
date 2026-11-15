// CI check for the Mobile iOS workflow: the trail page's report form, drawn natively, posts from
// the app. `node check-ios-form.mjs <evidence-dir> <app-id> <simulator-udid>`, with
// `farm dev --mobile --os ios` running, the app installed, and idb (fb-idb and idb_companion) on
// the PATH. It opens /trails/creek, types a report, taps Post report, and requires the report on
// the redrawn native screen, and after a pull to refresh, with no fallback to the web screen.
// Elements are found in the accessibility tree the shell gives server screens (labels, buttons).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [evidenceDir, appId, udid] = process.argv.slice(2);
assert(
  evidenceDir && appId && udid,
  "Pass the evidence directory, the app id, and the simulator UDID.",
);
const PAGE = "/trails/creek";
const REPORT = "Muddy past the bridge";
const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
// idb and the companion it starts use IDB_DEVELOPER_DIR's simulator frameworks when it is set.
const idbEnv = process.env.IDB_DEVELOPER_DIR
  ? { ...process.env, DEVELOPER_DIR: process.env.IDB_DEVELOPER_DIR }
  : process.env;
const idbRun = (args) =>
  execFileSync("idb", args, {
    encoding: "utf8",
    env: idbEnv,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
const idb = (...args) => idbRun([...args, "--udid", udid]);
const simctl = (...args) => run("xcrun", ["simctl", ...args]);

// The app's log since this check started, to count the screen's redraws and catch a fallback.
const pad = (value) => String(value).padStart(2, "0");
const now = new Date();
const started = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
const appLog = () =>
  simctl(
    "spawn",
    udid,
    "log",
    "show",
    "--start",
    started,
    "--style",
    "compact",
    "--predicate",
    'process == "App"',
  );
/** How many times the trail screen drew a tree: its first load, each reload in place. */
const redraws = () =>
  appLog()
    .split(/\r?\n/)
    .filter((line) =>
      line.endsWith(`[dev.farmjs.mobile.shell:FarmShell] server screen ready: ${PAGE}`),
    ).length;

/**
 * The app's accessibility tree, flattened, with each element's frame in points. describe-all can
 * fail while the screen is changing: try again a few times.
 */
let lastTree = "";
function elements() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      lastTree = idb("ui", "describe-all");
      const parsed = JSON.parse(lastTree);
      return (Array.isArray(parsed) ? parsed : [parsed]).map((element) => {
        const frame = element.frame ?? { x: 0, y: 0, width: 0, height: 0 };
        return {
          type: String(element.type ?? ""),
          label: String(element.AXLabel ?? ""),
          value: String(element.AXValue ?? ""),
          frame,
          x: Math.round(frame.x + frame.width / 2),
          y: Math.round(frame.y + frame.height / 2),
        };
      });
    } catch (error) {
      if (attempt >= 5) throw error;
      execFileSync("sleep", ["1"]);
    }
  }
}

/** The last tree, one element per line, for the job log. */
function summary() {
  try {
    const parsed = JSON.parse(lastTree);
    return (Array.isArray(parsed) ? parsed : [parsed])
      .map((element) => {
        const { x = 0, y = 0, width = 0, height = 0 } = element.frame ?? {};
        return `${element.type} ${JSON.stringify(element.AXLabel ?? "")} value=${JSON.stringify(element.AXValue ?? "")} at ${x},${y} ${width}x${height}`;
      })
      .join("\n");
  } catch {
    return lastTree;
  }
}

const isField = (element) => /^Text(Field|View|Area)$/.test(element.type);

/** Wait for an element, looking again each second. */
async function waitFor(predicate, what, attempts = 45) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = elements().find(predicate);
    if (found) return found;
    await sleep(1000);
  }
  await writeFile(path.join(evidenceDir, "form-tree.json"), lastTree);
  await screenshot("form-timeout.png");
  console.error(summary());
  throw new Error(`Timed out waiting for ${what}. Inspect form-tree.json and form-timeout.png.`);
}

/** Whether the trail screen drew more trees than `count` within `looks` reads of its log. */
async function redrawn(count, looks) {
  for (let attempt = 0; attempt < looks; attempt += 1) {
    if (redraws() > count) return true;
    await sleep(1000);
  }
  return false;
}

async function failRedraw(what) {
  await writeFile(path.join(evidenceDir, "form-log.txt"), appLog());
  await screenshot("form-timeout.png");
  throw new Error(`The trail screen did not draw again after ${what}. Inspect form-log.txt.`);
}

/** Wait until the trail screen drew more trees than `count`. */
async function waitForRedraw(count, what) {
  if (!(await redrawn(count, 45))) await failRedraw(what);
}

const screenshot = async (name) => simctl("io", udid, "screenshot", path.join(evidenceDir, name));

idbRun(["connect", udid]);
simctl("launch", "--terminate-running-process", udid, appId, "-FarmOpen", PAGE);
await waitFor((element) => element.label === "Post report", "the native report form");
await waitForRedraw(0, "opening the page");
await screenshot("form-before.png");

// The second field is the report (the first is the name).
const fields = elements()
  .filter(isField)
  .sort((a, b) => a.y - b.y);
assert(fields.length >= 2, `Expected the name and report fields, found ${JSON.stringify(fields)}.`);
idb("ui", "tap", String(fields[1].x), String(fields[1].y));
await sleep(500);
idb("ui", "text", REPORT);
await waitFor((element) => isField(element) && element.value === REPORT, "the typed report");
await writeFile(path.join(evidenceDir, "form-typed-tree.json"), lastTree);
await screenshot("form-typed.png");

const drawn = redraws();
const button = await waitFor(
  (element) => element.label === "Post report",
  "the Post report button",
);
idb("ui", "tap", String(button.x), String(button.y));

// Post/redirect/get back to /trails/creek: the screen loads the tree again in place.
await waitForRedraw(drawn, "posting the report");
await waitFor((element) => element.label === REPORT && !isField(element), "the posted report");
await screenshot("form-after.png");

// Pull to refresh: the screen loads its tree again in place and keeps the report.
const posted = redraws();
const screen = elements().find((element) => element.type === "Application")?.frame;
const middle = String(Math.round((screen?.width ?? 390) / 2));
// A slow drag down from the page's top, in small steps so the scroll view tracks it; pull again,
// as the Android check pulls more than once, if the refresh control did not take the drag.
let refreshed = false;
for (let pull = 0; pull < 3 && !refreshed; pull += 1) {
  idb("ui", "swipe", middle, "160", middle, "660", "--duration", "1", "--delta", "10");
  refreshed = await redrawn(posted, 15);
}
if (!refreshed) await failRedraw("three pulls to refresh");
await waitFor(
  (element) => element.label === REPORT && !isField(element),
  "the report after a pull to refresh",
);
await screenshot("form-refreshed.png");

const log = appLog();
await writeFile(path.join(evidenceDir, "form-log.txt"), log);
assert(!log.includes("showing the web screen"), "The trail screen fell back to the web screen.");
console.log("The native trail screen posted its report form and drew the result.");
