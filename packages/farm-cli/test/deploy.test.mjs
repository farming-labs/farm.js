import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveCloudflareAgentDeployPlan } = require("../dist/index.js");

test("reads a Cloudflare Agents Worker deployment handoff", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "farm-cli-cf-agent-"));
  await mkdir(path.join(root, ".farm", "cf-agent"), { recursive: true });
  await writeFile(path.join(root, ".farm-cf-agent.wrangler.jsonc"), "{}\n");
  await writeFile(
    path.join(root, ".farm", "cf-agent", "deploy.json"),
    JSON.stringify({
      version: 1,
      provider: "cloudflare-agents",
      config: ".farm-cf-agent.wrangler.jsonc",
      environment: "staging",
    }),
  );

  assert.deepEqual(resolveCloudflareAgentDeployPlan(root), {
    configPath: path.join(root, ".farm-cf-agent.wrangler.jsonc"),
    environment: "staging",
  });
});

test("keeps generated deployment configs inside the Farm root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "farm-cli-cf-agent-unsafe-"));
  await mkdir(path.join(root, ".farm", "cf-agent"), { recursive: true });
  await writeFile(
    path.join(root, ".farm", "cf-agent", "deploy.json"),
    JSON.stringify({
      version: 1,
      provider: "cloudflare-agents",
      config: "../wrangler.jsonc",
    }),
  );

  assert.throws(
    () => resolveCloudflareAgentDeployPlan(root),
    /must stay inside the Farm project root/,
  );
});
