import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createFarmDeployPlan,
  formatFarmDeployPlan,
  resolveCloudflareAgentDeployPlan,
} = require("../dist/index.js");

test("resolves a deployment plan without building or invoking a platform CLI", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "farm-cli-deploy-plan-"));
  await writeFile(
    path.join(root, "farm.config.mjs"),
    "export default { deploy: { target: 'vercel', preset: 'vercel' } };\n",
  );

  try {
    const plan = await createFarmDeployPlan({ root, prod: true });

    assert.equal(plan.target, "vercel");
    assert.equal(plan.preset, "vercel");
    assert.equal(plan.runtime, "node");
    assert.equal(plan.build.command, "farm build --preset vercel");
    assert.equal(plan.deploy.command, "vercel deploy --prebuilt --yes --prod");
    assert.match(formatFarmDeployPlan(plan), /FARM \/ DEPLOY PLAN/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
