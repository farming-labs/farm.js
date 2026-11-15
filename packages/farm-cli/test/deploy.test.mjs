import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createFarmDeployPlan,
  formatFarmDeployPlan,
  resolveCloudflareAgentDeployPlan,
  resolveDeployCliCommand,
  resolveDeployCliExecutable,
} = require("../dist/index.js");

test("resolves project-local deployment CLIs and Windows shims", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "farm-cli-deploy-cli-"));
  try {
    const bin = path.join(root, "node_modules", ".bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "wrangler"), "");
    await writeFile(path.join(bin, "wrangler.cmd"), "");

    assert.equal(
      resolveDeployCliExecutable("wrangler", root, "darwin"),
      path.join(bin, "wrangler"),
    );
    assert.equal(
      resolveDeployCliExecutable("wrangler", root, "win32"),
      path.join(bin, "wrangler.cmd"),
    );
    assert.equal(resolveDeployCliExecutable("vercel", root, "win32"), "vercel.cmd");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("quotes a Windows CLI shim's arguments for cmd.exe", () => {
  const cli = resolveDeployCliCommand(
    "wrangler",
    ["deploy", "--config", String.raw`C:\Users\Jane Doe\app & co\100%\wrangler.json`],
    path.join(tmpdir(), "farm-cli-deploy-no-local-cli"),
    "win32",
  );

  // One escaped command line for cmd.exe, so Node has no arguments to join unquoted. Arguments
  // are escaped once for cmd.exe and once more for the %* the .cmd shim hands to node.
  assert.deepEqual(cli, {
    file: String.raw`wrangler.cmd ^^^"deploy^^^" ^^^"--config^^^" ^^^"C:\Users\Jane^^^ Doe\app^^^ ^^^&^^^ co\100^^^%\wrangler.json^^^"`,
    args: [],
    shell: true,
  });
});

test("quotes a project-local Windows CLI shim under a path with spaces", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "farm cli deploy "));
  try {
    const bin = path.join(root, "node_modules", ".bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "vercel.cmd"), "");

    const cli = resolveDeployCliCommand("vercel", ["--version"], root, "win32");

    const shim = path.join(bin, "vercel.cmd").replace(/([()\][%!^"`<>&|;, *?])/g, "^$1");
    assert.match(shim, /farm\^ cli\^ deploy\^ /);
    assert.deepEqual(cli, { file: `${shim} ^^^"--version^^^"`, args: [], shell: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs a project-local deployment CLI from a path with spaces", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "farm cli deploy run "));
  try {
    const bin = path.join(root, "node_modules", ".bin");
    await mkdir(bin, { recursive: true });
    await writeFile(
      path.join(root, "wrangler.js"),
      "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
    );
    const isWindows = process.platform === "win32";
    await writeFile(
      path.join(bin, isWindows ? "wrangler.cmd" : "wrangler"),
      isWindows
        ? `@"${process.execPath}" "%~dp0\\..\\..\\wrangler.js" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/../../wrangler.js" "$@"\n`,
      { mode: 0o755 },
    );
    const configPath = path.join(root, "dist", "wrangler & co.json");

    const cli = resolveDeployCliCommand("wrangler", ["deploy", "--config", configPath], root);
    const output = execFileSync(cli.file, cli.args, {
      cwd: root,
      encoding: "utf8",
      shell: cli.shell,
    });

    assert.deepEqual(JSON.parse(output), ["deploy", "--config", configPath]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

test("rejects a custom Vercel output that --prebuilt cannot upload", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-vercel-custom-output-"));
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { target: 'vercel', outputDir: 'custom-output' } };\n",
    );

    await assert.rejects(
      () => createFarmDeployPlan({ root }),
      /Vercel prebuilt deploys require output at .*\.vercel.*output/,
    );
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

test("rejects a Cloudflare Agent config that resolves outside the Farm root", async () => {
  let temporaryRoot;

  try {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "farm-cli-cf-agent-symlink-"));
    const root = path.join(temporaryRoot, "project");
    const externalDirectory = path.join(temporaryRoot, "external");
    await mkdir(path.join(root, ".farm", "cf-agent"), { recursive: true });
    await mkdir(externalDirectory);
    await writeFile(path.join(externalDirectory, "wrangler.jsonc"), "{}\n");
    await symlink(externalDirectory, path.join(root, "cloudflare"), "junction");
    await writeFile(
      path.join(root, ".farm", "cf-agent", "deploy.json"),
      JSON.stringify({
        version: 1,
        provider: "cloudflare-agents",
        config: "cloudflare/wrangler.jsonc",
      }),
    );

    assert.throws(
      () => resolveCloudflareAgentDeployPlan(root),
      /must stay inside the Farm project root/,
    );
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
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

test("rejects a configured Cloudflare Agent source config through an outside symlink", async () => {
  let temporaryRoot;

  try {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "farm-cli-cf-agent-source-symlink-"));
    const root = path.join(temporaryRoot, "project");
    const externalDirectory = path.join(temporaryRoot, "external");
    await mkdir(root);
    await mkdir(externalDirectory);
    await writeFile(path.join(externalDirectory, "wrangler.jsonc"), "{}\n");
    await symlink(externalDirectory, path.join(root, "cloudflare"), "junction");
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
        "      instance: { config: 'cloudflare/wrangler.jsonc' },",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    await assert.rejects(
      () => createFarmDeployPlan({ root }),
      /Cloudflare Agents source config must stay inside the Farm project root/,
    );
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
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
    assert.equal(plan.deploy.command, "netlify deploy --prod --no-build --dir=dist");
    assert.equal(plan.deploy.cwd, root);
    assert.match(formatFarmDeployPlan(plan), /Production: yes/);
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("points Netlify at the server function in a custom output directory", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-netlify-custom-output-"));
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { target: 'netlify', output: '.output' } };\n",
    );

    const plan = await createFarmDeployPlan({ root });

    assert.equal(
      plan.deploy.command,
      "netlify deploy --prod --no-build --dir=dist --functions=.output/server",
    );
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
    assert.deepEqual(plan.deploy.args, [
      "deploy",
      "--prod",
      "--no-build",
      "--dir=dist",
      `--site=${site}`,
    ]);
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
      "export default { deploy: { preset: 'cloudflare-module' } };\n",
    );

    const plan = await createFarmDeployPlan({ root, cloudflare: true });

    assert.equal(plan.target, "cloudflare");
    assert.equal(plan.preset, "cloudflare-module");
    assert.equal(plan.runtime, "edge");
    assert.equal(plan.outputDir, path.join(root, ".farm", ".output"));
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("rejects the vercel-edge preset before planning a Vercel deploy", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-deploy-vercel-edge-"));
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { preset: 'vercel-edge' } };\n",
    );

    await assert.rejects(createFarmDeployPlan({ root, vercel: true }), {
      message:
        'Deploy preset "vercel-edge" is not supported: Farm\'s Nitro version has no vercel-edge preset. Use the "vercel" preset instead, which deploys Vercel Functions on Fluid compute.',
    });
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("rejects an unknown deploy target before planning a deploy", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-deploy-unknown-target-"));
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { target: 'vercell' } };\n",
    );

    // With a platform flag the typo was ignored; without one the error blamed a missing target.
    for (const options of [{ root, vercel: true }, { root }]) {
      await assert.rejects(createFarmDeployPlan(options), {
        message:
          'Unknown deploy target "vercell". Farm\'s deploy targets are "vercel", "cloudflare", "netlify", "node". To build with another Nitro preset, set deploy.preset instead.',
      });
    }
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("keeps a custom preset when its configured target matches the flag", async () => {
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "farm-cli-deploy-custom-preset-"));
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { target: 'vercel', preset: 'custom-vercel' } };\n",
    );

    const plan = await createFarmDeployPlan({ root, vercel: true });

    assert.equal(plan.target, "vercel");
    assert.equal(plan.preset, "custom-vercel");
    assert.equal(plan.outputDir, path.join(root, ".vercel", "output"));
    assert.equal(plan.build.command, "farm build --preset custom-vercel");
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});
