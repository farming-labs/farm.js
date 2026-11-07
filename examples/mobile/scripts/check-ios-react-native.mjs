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
| runtime start (warm(), bundle evaluated) | ${median(warmUps) ?? "n/a"} ms | ${warmUps.join(", ")} |

| size | |
| --- | --- |
| simulator app (arm64 + x86_64) | ${mb(kb("app_kb"))} |
| its frameworks | ${frameworks.join(", ")} |
| Hermes bytecode | ${mb(kb("bundle_kb"))} |
| React Native device slices (arm64) | ${mb(kb("device_slices_kb"))}, ${mb(kb("device_slices_zip_kb"))} zipped |
`);
