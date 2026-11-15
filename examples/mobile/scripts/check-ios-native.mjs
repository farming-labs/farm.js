// CI evidence check for the iOS simulator run, shared by the examples the Mobile iOS workflow
// launches: `node check-ios-native.mjs <evidence-dir> [route...]`. The home route and every route
// listed after the directory must select a server screen, and the home route, the one the
// simulator opens, must draw native content and never fall back to the web screen.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const [evidenceDir, ...routes] = process.argv.slice(2);
assert(evidenceDir, "Pass the simulator evidence directory to `check-ios-native.mjs`.");
const manifest = JSON.parse(await readFile(path.join(evidenceDir, "farm-routes.json"), "utf8"));
const log = await readFile(path.join(evidenceDir, "app-log.txt"), "utf8");

for (const route of new Set(["/", ...routes])) {
  assert(
    manifest.rules.some((rule) => rule.route === route && rule.screen === "server"),
    route === "/"
      ? "The home route must select a server screen. Check the example's `export const mobile`."
      : `The ${route} route must select a server screen. \`pnpm report\` names the blocker.`,
  );
}
assert(
  !log.includes("showing the web screen"),
  "A server screen fell back to the web screen. Inspect `app-log.txt` for the failure.",
);
assert(
  log.split(/\r?\n/).some((line) =>
    line.endsWith("[dev.farmjs.mobile.shell:FarmShell] server screen ready: /"),
  ),
  "No native completion for the home route. Inspect `app-log.txt` and the simulator screenshots.",
);
console.log("The home server screen installed native content without a web fallback.");
