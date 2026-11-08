// CI check for the Mobile Android workflow: the trail page's report form, drawn natively, posts
// from the app. `node check-android-form.mjs <evidence-dir> <app-id>`, with `farm dev --mobile`
// running and the app installed. It opens /trails/creek, types a report, taps Post report, and
// requires the report on the redrawn native screen with no fallback to the web screen.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [evidenceDir, appId] = process.argv.slice(2);
assert(evidenceDir && appId, "Pass the evidence directory and the app id.");
const ADB = path.join(process.env.ANDROID_HOME ?? "", "platform-tools", "adb");
const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8" });
const REPORT = "Muddy past the bridge";

/**
 * Dump the UI. `uiautomator dump` sometimes exits 137 (killed) after writing the file, or fails
 * while the screen is changing: keep a dump that says it was written, and try again otherwise.
 */
function dump() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      adb("shell", "uiautomator", "dump", "/sdcard/farm-ui.xml");
    } catch (error) {
      const written = String(error.stdout ?? "").includes("dumped to");
      if (!written && attempt < 5) {
        execFileSync("sleep", ["1"]);
        continue;
      }
      if (!written) throw error;
    }
    return adb("shell", "cat", "/sdcard/farm-ui.xml");
  }
}

/** The visible UI as uiautomator nodes: class, text, and the center of their bounds. */
function nodes() {
  const xml = dump();
  return [...xml.matchAll(/<node\b([^>]*?)\/?>/g)].map(([, attributes]) => {
    const read = (name) => new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? "";
    const [x1, y1, x2, y2] = read("bounds").match(/\d+/g)?.map(Number) ?? [0, 0, 0, 0];
    return {
      className: read("class"),
      text: read("text"),
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
    };
  });
}

/** Wait for a node, scrolling the screen up between looks. */
async function waitFor(predicate, what) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = nodes().find(predicate);
    if (found) return found;
    if (attempt % 4 === 3) adb("shell", "input", "swipe", "540", "1600", "540", "800", "300");
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

const screenshot = async (name) =>
  writeFile(
    path.join(evidenceDir, name),
    execFileSync(ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 }),
  );

adb("logcat", "-c");
adb("shell", "am", "start", "-S", "-W", "-n", `${appId}/dev.farmjs.mobile.shell.MainActivity`, "--es", "farmOpen", "/trails/creek");
await waitFor((node) => node.text === "Post report", "the native report form");
await screenshot("form-before.png");

// The second field is the report (the first is the name).
const fields = nodes().filter((node) => node.className === "android.widget.EditText");
assert(fields.length >= 2, `Expected the name and report fields, found ${fields.length}.`);
adb("shell", "input", "tap", String(fields[1].x), String(fields[1].y));
await sleep(500);
adb("shell", "input", "text", REPORT.replaceAll(" ", "%s"));
// Hide the keyboard so it does not cover the button.
adb("shell", "input", "keyevent", "111");
await sleep(500);
const button = await waitFor((node) => node.text === "Post report", "the Post report button");
adb("shell", "input", "tap", String(button.x), String(button.y));

// Post/redirect/get back to /trails/creek: the screen loads the tree again in place.
await waitFor((node) => node.text === REPORT && node.className === "android.widget.TextView", "the posted report");
await screenshot("form-after.png");

const log = adb("logcat", "-d", "-s", "FarmShell:V", "AndroidRuntime:E");
await writeFile(path.join(evidenceDir, "form-log.txt"), log);
assert(!log.includes("showing the web screen"), "The trail screen fell back to the web screen.");
assert(!/FATAL EXCEPTION/.test(log), "The app crashed. Inspect form-log.txt.");
console.log("The native trail screen posted its report form and drew the result.");
