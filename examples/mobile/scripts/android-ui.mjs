// CI only: read and drive the Android emulator's screen through adb for the Mobile Android
// workflow's device checks (check-android-form.mjs, check-android-native-actions.mjs). It reads
// the visible UI with `uiautomator dump`, finds nodes by class and text, and taps their bounds.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ADB = path.join(process.env.ANDROID_HOME ?? "", "platform-tools", "adb");

export const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8" });

/**
 * Dump the UI. `uiautomator dump` sometimes exits 137 (killed) after writing the file, or fails
 * while the screen is changing, even with exit 0 ("null root node returned by
 * UiTestAutomationBridge" while an activity starts): keep a dump that says it was written, and
 * try again otherwise.
 */
export function dump() {
  for (let attempt = 1; ; attempt += 1) {
    let output;
    let failure;
    try {
      output = adb("shell", "uiautomator", "dump", "/sdcard/farm-ui.xml");
    } catch (error) {
      output = String(error.stdout ?? "");
      failure = error;
    }
    if (output.includes("dumped to")) return adb("shell", "cat", "/sdcard/farm-ui.xml");
    if (attempt >= 5) throw failure ?? new Error(`uiautomator dump wrote no file: ${output.trim()}`);
    execFileSync("sleep", ["1"]);
  }
}

/**
 * The visible UI as uiautomator nodes: class, text, the center of their bounds, and whether the
 * node is a WebView or inside one. A WebView the shell keeps warm behind a native screen can hold
 * the same page, so a check of native views skips `inWebView` nodes.
 */
export function nodes() {
  const xml = dump();
  const found = [];
  // Open WebView ancestors of the current node, counted while walking the nested <node> tags.
  const stack = [];
  for (const [tag, attributes, selfClosing] of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (tag === "</node>") {
      stack.pop();
      continue;
    }
    const read = (name) => new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? "";
    const [x1, y1, x2, y2] = read("bounds").match(/\d+/g)?.map(Number) ?? [0, 0, 0, 0];
    const className = read("class");
    const inWebView = className === "android.webkit.WebView" || stack.at(-1) === true;
    found.push({
      className,
      text: read("text"),
      inWebView,
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
    });
    if (!selfClosing) stack.push(inWebView);
  }
  return found;
}

/** Wait for a node, scrolling the screen up between looks. */
export async function waitFor(predicate, what) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = nodes().find(predicate);
    if (found) return found;
    if (attempt % 4 === 3) adb("shell", "input", "swipe", "540", "1600", "540", "800", "300");
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

export const tap = (node) => adb("shell", "input", "tap", String(node.x), String(node.y));

/** Tap a field and type into it, then hide the keyboard so it does not cover what is below. */
export async function type(field, text) {
  tap(field);
  await sleep(500);
  adb("shell", "input", "text", text.replaceAll(" ", "%s"));
  adb("shell", "input", "keyevent", "111");
  await sleep(500);
}

export const screenshot = async (evidenceDir, name) =>
  writeFile(
    path.join(evidenceDir, name),
    execFileSync(ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 }),
  );
