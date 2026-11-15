// CI check for the Mobile Android workflow: server actions run from /native, a native-tier screen
// (RFC 0004), when tapped on a device. `node scripts/check-android-native-actions.mjs <evidence-dir>
// <app-id>`, from this example, after `farm build --mobile --apk` with its production server
// reachable from the emulator and the APK installed. It opens /native from the app's web home page, requires a server screen
// drawn with native views, types a note into each form, taps its button, and requires the note on
// the redrawn native screen: once through the action that redirects (post/redirect/get) and once
// through the inline action whose answer is the page again, with no fallback to the web screen.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { adb, nodes, screenshot as capture, tap, type, waitFor } from "../../mobile/scripts/android-ui.mjs";

const [evidenceDir, appId] = process.argv.slice(2);
assert(evidenceDir && appId, "Pass the evidence directory and the app id.");
const NOTE = "Tapped on Android";
const URGENT = "Inline from Android";
const screenshot = (name) => capture(evidenceDir, name);
// Only the shell's native views: a warm WebView behind the screen can hold the same page, with
// its own "Add note" button and fields.
const native = (text) => (node) =>
  !node.inWebView && node.text === text && node.className === "android.widget.TextView";
const nativeFields = () =>
  nodes().filter((node) => !node.inWebView && node.className === "android.widget.EditText");

const manifest = JSON.parse(await readFile(".farm/output/mobile/farm-routes.json", "utf8"));
await writeFile(path.join(evidenceDir, "farm-routes.json"), JSON.stringify(manifest, null, 2));
assert.equal(
  manifest.rules.find((rule) => rule.route === "/native")?.screen,
  "server",
  "/native must select a server screen. `farm config inspect --mobile --report` names the blocker.",
);

const readLog = async () => {
  const log = adb("logcat", "-d", "-s", "FarmShell:V", "AndroidRuntime:E");
  await writeFile(path.join(evidenceDir, "native-actions-log.txt"), log);
  return log;
};

adb("logcat", "-c");
// The app opens on its web home page; the debug build's farmOpen extra then visits /native, as a
// tapped link would, once that first screen reports itself ready.
adb(
  "shell", "am", "start", "-S", "-W", "-n", `${appId}/dev.farmjs.mobile.shell.MainActivity`,
  "--es", "farmOpen", "/native",
);
try {
  await waitFor(native("Native notes"), "the native /native screen");
  await screenshot("native-before.png");
  // Drawn by the shell from the server's tree, not a WebView: only a native screen reports this.
  const opened = await readLog();
  assert.match(opened, /visit \/native -> server/, "The shell did not open /native as a server screen.");
  assert.match(opened, /native app\/native open->content=\d+ms/, "/native never drew native content.");

  // The first field belongs to the redirecting action's form, the second to the inline action's.
  const fields = nativeFields();
  assert(fields.length >= 2, `Expected the note and urgent note fields, found ${fields.length}.`);

  // The redirecting action: post/redirect/get back to /native, which the screen loads in place.
  await type(fields[0], NOTE);
  tap(await waitFor(native("Add note"), "the native Add note button"));
  await waitFor(native(NOTE), "the note the redirecting server action added");
  await screenshot("native-after-redirect.png");

  // The inline action: the server answers with the page again (RSC) or redirects back (islx), and
  // the screen draws the result in place.
  const urgentField = nativeFields()[1];
  assert(urgentField, "The urgent note field is gone after the first action.");
  await type(urgentField, URGENT);
  tap(await waitFor(native("Add urgent"), "the native Add urgent button"));
  await waitFor(native(`${URGENT} (urgent)`), "the note the inline server action added");
  assert(nodes().some(native(NOTE)), "The first note is gone after the inline action.");
  await screenshot("native-after-inline.png");
} catch (error) {
  // What the screen showed instead: an alert for a failed action, or a web screen.
  console.error((await readLog()).split("\n").slice(-40).join("\n"));
  await screenshot("native-failure.png");
  const shown = nodes().filter((node) => node.text);
  console.error(
    shown.map((node) => `${node.inWebView ? "web " : ""}${node.className} "${node.text}"`).join("\n"),
  );
  throw error;
}

const log = await readLog();
assert(!log.includes("showing the web screen"), "The /native screen fell back to the web screen.");
// The app's own crash names its process ("Process: <id>, PID: …"). uiautomator, killed while
// dumping, logs a FATAL EXCEPTION of its own in thread "UiAutomation", which is not the app's.
assert(
  !log.includes(`Process: ${appId},`),
  "The app crashed (FATAL EXCEPTION). Inspect native-actions-log.txt.",
);
console.log("The native /native screen ran both server actions when tapped and drew their results.");
