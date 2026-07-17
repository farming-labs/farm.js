import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentRuntimeSmoke } from "./smoke-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedConfig = resolve(root, ".farm-cf-agent.wrangler.jsonc");

try {
  await access(generatedConfig);
} catch {
  throw new Error("Build the example before running its combined Worker smoke test.");
}

const origin = await runAgentRuntimeSmoke({
  command: "wrangler",
  args: (port) => [
    "dev",
    "--config",
    generatedConfig,
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--show-interactive-dev-session=false",
  ],
  instancePrefix: "combined-worker",
});

console.log(`Combined Farm and Cloudflare Agent Worker is healthy at ${origin}`);
