import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const commands = [
  [
    "--filter",
    "@farm.js/core",
    "exec",
    "vitest",
    "run",
    "src/__tests__/renderer.test.ts",
    "src/__tests__/renderer-react-client.test.ts",
  ],
  ["--filter", "@farm.js/preact", "test"],
  ["--filter", "@farm.js/solid", "test"],
  ["--filter", "@farm.js/vue", "test"],
  ["--filter", "@farm.js/svelte", "test"],
  ["--filter", "@farm.js/preact", "type-check"],
  ["--filter", "@farm.js/solid", "type-check"],
  ["--filter", "@farm.js/vue", "type-check"],
  ["--filter", "@farm.js/svelte", "type-check"],
];

for (const args of commands) {
  const result = spawnSync(pnpm, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
