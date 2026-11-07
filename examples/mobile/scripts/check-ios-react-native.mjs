// CI evidence check for the iOS React Native host (RFC 0004, decisions): the production app opens
// the native-only /kit screen, cold and warm, as a React Native surface with no fallback. Prints
// the measured cold and warm open times and the app size as a Markdown summary.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const evidenceDir = process.argv[2];
assert(evidenceDir, "Pass the simulator evidence directory to `check-ios-react-native.mjs`.");
const log = await readFile(path.join(evidenceDir, "kit-log.txt"), "utf8");
const size = await readFile(path.join(evidenceDir, "kit-size.txt"), "utf8").catch(() => "");

const failure = log
  .split(/\r?\n/)
  .find((line) => /react-native failed|native screen app\/kit failed|app\/kit could not open|unavailable and/.test(line));
assert(!failure, `/kit did not render as a React Native screen:\n${failure}\nInspect kit-log.txt.`);

// /map links netinfo and the app's Device module; a module missing on iOS fails its import.
const mapFailure = log
  .split(/\r?\n/)
  .find((line) => /native screen app\/map failed|showing the web screen for \/map/.test(line));
assert(!mapFailure, `/map fell back to its web screen:\n${mapFailure}\nInspect kit-log.txt and map.png.`);
assert(
  /native app\/map open->content=\d+ms/.test(log),
  "/map never reached first content. Inspect kit-log.txt and map.png.",
);
// /map calls modules/farm-swift-sample, a module written in Swift as community modules are.
assert(
  /FarmSwiftSample answered from Swift: \S+/.test(log),
  "/map's Swift module never answered: it did not link or did not register. Inspect kit-log.txt and map.png.",
);

// Each launch logs "launch open /kit after <ms>ms", then the surface's first content.
const opens = [];
let after;
for (const line of log.split(/\r?\n/)) {
  const launch = /launch open \/kit after (\d+)ms/.exec(line);
  if (launch) after = Number(launch[1]);
  const content = /native app\/kit open->content=(\d+)ms/.exec(line);
  if (content && after !== undefined) {
    opens.push({ mode: after === 0 ? "cold" : "warm", ms: Number(content[1]) });
    after = undefined;
  }
}
const launches = [...log.matchAll(/process->didFinishLaunching=(\d+)ms process->first-content=(\d+)ms/g)];
const preMain = launches.map((match) => Number(match[1]));
const firstContent = launches.map((match) => Number(match[2]));
const warmUps = [...log.matchAll(/react-native warm in (\d+)ms/g)].map((match) => Number(match[1]));
const cold = opens.filter((open) => open.mode === "cold").map((open) => open.ms);
const warm = opens.filter((open) => open.mode === "warm").map((open) => open.ms);
assert(cold.length > 0, "No cold open of /kit reached first content. Inspect kit-log.txt and kit-cold-*.png.");
assert(warm.length > 0, "No warm open of /kit reached first content. Inspect kit-log.txt and kit-warm-*.png.");

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
};
const kb = (name) => Number(new RegExp(`^${name}=(\\d+)`, "m").exec(size)?.[1] ?? NaN);
const mb = (value) => (Number.isFinite(value) ? `${(value / 1024).toFixed(1)} MB` : "n/a");
const frameworks = [...size.matchAll(/^framework_kb (\S+)=(\d+)/gm)].map(
  ([, name, value]) => `${name} ${mb(Number(value))}`,
);

console.log(`### iOS React Native host: /kit on the simulator

| | median | runs |
| --- | --- | --- |
| cold open (visit to first content, runtime starting) | ${median(cold)} ms | ${cold.join(", ")} |
| warm open (runtime already started) | ${median(warm)} ms | ${warm.join(", ")} |
| host start (warm() to hostDidStart; the bundle runs after) | ${median(warmUps) ?? "n/a"} ms | ${warmUps.join(", ")} |
| app launch: process start to didFinishLaunching (dyld loads React Native) | ${median(preMain) ?? "n/a"} ms | ${preMain.join(", ")} |
| app launch: process start to the first tab's content | ${median(firstContent) ?? "n/a"} ms | ${firstContent.join(", ")} |

| size | |
| --- | --- |
| simulator app (arm64 + x86_64) | ${mb(kb("app_kb"))} |
| its frameworks | ${frameworks.join(", ")} |
| Hermes bytecode | ${mb(kb("bundle_kb"))} |
| React Native device slices (arm64) | ${mb(kb("device_slices_kb"))}, ${mb(kb("device_slices_zip_kb"))} zipped |
`);
