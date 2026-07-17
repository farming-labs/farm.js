import { runAgentRuntimeSmoke } from "./smoke-runtime.mjs";

const origin = await runAgentRuntimeSmoke({
  command: "farm",
  args: (port) => ["dev", "--port", String(port)],
  instancePrefix: "farm-dev",
});

console.log(`Farm and Cloudflare Agents are healthy at ${origin}`);
