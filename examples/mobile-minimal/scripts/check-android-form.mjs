// CI check for the Mobile Android workflow: the trail page's report form, drawn natively, posts
// from the app. `node check-android-form.mjs <evidence-dir> <app-id>`, with `farm dev --mobile`
// running and the app installed. It opens /trails/creek, types a report, taps Post report, and
// requires the report on the redrawn native screen, and after a pull to refresh, with no fallback
// to the web screen.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { adb, nodes, screenshot as capture, tap, type, waitFor } from "../../mobile/scripts/android-ui.mjs";

const [evidenceDir, appId] = process.argv.slice(2);
assert(evidenceDir && appId, "Pass the evidence directory and the app id.");
const REPORT = "Muddy past the bridge";
const screenshot = (name) => capture(evidenceDir, name);

adb("logcat", "-c");
adb("shell", "am", "start", "-S", "-W", "-n", `${appId}/dev.farmjs.mobile.shell.MainActivity`, "--es", "farmOpen", "/trails/creek");
await waitFor((node) => node.text === "Post report", "the native report form");
await screenshot("form-before.png");

// The second field is the report (the first is the name).
const fields = nodes().filter((node) => node.className === "android.widget.EditText");
assert(fields.length >= 2, `Expected the name and report fields, found ${fields.length}.`);
await type(fields[1], REPORT);
tap(await waitFor((node) => node.text === "Post report", "the Post report button"));

// Post/redirect/get back to /trails/creek: the screen loads the tree again in place.
await waitFor((node) => node.text === REPORT && node.className === "android.widget.TextView", "the posted report");
await screenshot("form-after.png");

// Pull to refresh: the screen loads its tree again in place and keeps the report.
for (let pull = 0; pull < 3; pull += 1) adb("shell", "input", "swipe", "540", "500", "540", "1700", "250");
await sleep(2000);
await waitFor((node) => node.text === REPORT, "the report after a pull to refresh");

const log = adb("logcat", "-d", "-s", "FarmShell:V", "AndroidRuntime:E");
await writeFile(path.join(evidenceDir, "form-log.txt"), log);
assert(!log.includes("showing the web screen"), "The trail screen fell back to the web screen.");
assert(!/FATAL EXCEPTION/.test(log), "The app crashed. Inspect form-log.txt.");
console.log("The native trail screen posted its report form and drew the result.");
