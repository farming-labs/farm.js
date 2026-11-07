// CI evidence check for the Android emulator run, the Android twin of `check-ios-native.mjs`:
// the home route must select a server screen, draw native content, and never fall back to web.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const evidenceDir = process.argv[2];
assert(evidenceDir, "Pass the emulator evidence directory to `check-android-native.mjs`.");
const manifest = JSON.parse(await readFile(path.join(evidenceDir, "farm-routes.json"), "utf8"));
const log = await readFile(path.join(evidenceDir, "app-log.txt"), "utf8");

assert(
  manifest.rules.some((rule) => rule.route === "/" && rule.screen === "server"),
  "The home route must select a server screen. Check the example's `export const mobile`.",
);
assert(
  !log.includes("showing the web screen"),
  "A native screen fell back to the web screen. Inspect `app-log.txt` for the failure.",
);
assert(
  !/FATAL EXCEPTION/.test(log),
  "The app crashed. Inspect `app-log.txt` and `logcat-full.txt`.",
);
assert(
  /FarmShell.*open->content=\d+ms/.test(log),
  "No native completion in the log. Inspect `app-log.txt` and the emulator screenshots.",
);
console.log("The home server screen drew native content on the emulator without a web fallback.");
