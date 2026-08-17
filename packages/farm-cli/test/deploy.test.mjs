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
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-deploy-plan-"));
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { target: 'vercel', preset: 'vercel' } };\n",
    );
    const plan = await createFarmDeployPlan({ root, prod: true });

    assert.equal(plan.target, "vercel");
    assert.equal(plan.preset, "vercel");
    assert.equal(plan.runtime, "node");
    assert.equal(plan.build.command, "farm build --preset vercel");
    assert.equal(plan.deploy.command, "vercel deploy --prebuilt --yes --prod");
    assert.match(formatFarmDeployPlan(plan), /FARM \/ DEPLOY PLAN/);
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("reads a Cloudflare Agents Worker deployment handoff", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-cf-agent-"));
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
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("keeps generated deployment configs inside the Farm root", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-cf-agent-unsafe-"));
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
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("plans the generated Cloudflare Agent config before the first build", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-cf-agent-first-run-"));
    await writeFile(
      path.join(root, "farm.config.mjs"),
      [
        "export default {",
        "  deploy: { target: 'cloudflare', preset: 'cloudflare-module' },",
        "  integrations: {",
        "    agent: {",
        "      kind: 'farm-integration',",
        "      category: 'agent',",
        "      type: 'cloudflare',",
        "      serverRuntime: false,",
        "      instance: { config: 'cloudflare/wrangler.jsonc', environment: 'staging' },",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const plan = await createFarmDeployPlan({ root });

    assert.deepEqual(plan.cloudflareAgent, {
      configPath: path.join(root, "cloudflare", ".farm-cf-agent.wrangler.jsonc"),
      environment: "staging",
      generated: true,
    });
    assert.equal(
      plan.deploy.command,
      `wrangler deploy --config ${path.join(root, "cloudflare", ".farm-cf-agent.wrangler.jsonc")} --env staging`,
    );
    assert.match(formatFarmDeployPlan(plan), /generated during build/);
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("reports Netlify deploys as production operations", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-netlify-plan-"));
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { target: 'netlify', preset: 'netlify' } };\n",
    );

    const plan = await createFarmDeployPlan({ root });

    assert.equal(plan.production, true);
    assert.equal(plan.deploy.command, "netlify deploy --prod --dir=.");
    assert.match(formatFarmDeployPlan(plan), /Production: yes/);
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("binds an untrusted Netlify site value to the intended option", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-netlify-safe-args-"));
    const site = "--alias=attacker; touch /tmp/farm-deploy-injected";
    await writeFile(
      path.join(root, "farm.config.mjs"),
      `export default ${JSON.stringify({
        deploy: { target: "netlify", preset: "netlify", netlify: { site } },
      })};\n`,
    );

    const plan = await createFarmDeployPlan({ root });

    assert.equal(plan.deploy.executable, "netlify");
    assert.deepEqual(plan.deploy.args, ["deploy", "--prod", "--dir=.", `--site=${site}`]);
    assert.match(
      plan.deploy.command,
      /'--site=--alias=attacker; touch \/tmp\/farm-deploy-injected'/,
    );
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("a target flag overrides a configured preset for another platform", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-deploy-cross-preset-"));
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { target: 'cloudflare', preset: 'cloudflare-module' } };\n",
    );

    const plan = await createFarmDeployPlan({ root, vercel: true });

    assert.equal(plan.target, "vercel");
    assert.equal(plan.preset, "vercel");
    assert.equal(plan.outputDir, path.join(root, ".vercel", "output"));
    assert.equal(plan.build.command, "farm build --preset vercel");
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("a target flag overrides a mismatched top-level preset", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-deploy-top-preset-"));
    await writeFile(path.join(root, "farm.config.mjs"), "export default { preset: 'vercel' };\n");

    const plan = await createFarmDeployPlan({ root, cloudflare: true });

    assert.equal(plan.target, "cloudflare");
    assert.equal(plan.preset, "cloudflare-pages");
    assert.equal(plan.outputDir, path.join(root, ".farm", ".output"));
    assert.equal(plan.build.command, "farm build --preset cloudflare-pages");
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("keeps a configured preset that already builds for the flagged platform", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-deploy-edge-preset-"));
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { preset: 'vercel-edge' } };\n",
    );

    const plan = await createFarmDeployPlan({ root, vercel: true });

    assert.equal(plan.target, "vercel");
    assert.equal(plan.preset, "vercel-edge");
    assert.equal(plan.runtime, "edge");
    assert.equal(plan.outputDir, path.join(root, ".vercel", "output"));
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});
