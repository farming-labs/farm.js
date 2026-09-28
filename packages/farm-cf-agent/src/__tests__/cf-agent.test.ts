import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";
import {
  assertCloudflareAgentNodeVersion,
  cfAgent,
  createWranglerDevArgs,
  writeCloudflareAgentOutput,
} from "../index";

describe("Cloudflare Agents integration", () => {
  it("mounts the Agents route with WebSocket development support", () => {
    const integration = cfAgent({ dev: false, origin: "http://127.0.0.1:8787" });

    expect(integration.category).toBe("agent");
    expect(integration.type).toBe("cloudflare");
    expect(integration.serverRuntime).toBe(true);
    expect(integration.instance).toMatchObject({
      provider: "cloudflare",
      routePrefix: "/agents",
      routePrefixes: ["/agents"],
      config: "wrangler.jsonc",
    });
    expect(integration.routes?.map((route) => route.path)).toEqual([
      "/agents/[...farmAgentRuntimePath]",
    ]);
  });

  it("leaves production agent routes to the composed Cloudflare Worker", () => {
    const integration = cfAgent({ dev: false });

    expect(integration.serverRuntime).toBe(false);
  });

  it("builds a deterministic Wrangler command and enforces Node 22", () => {
    expect(
      createWranglerDevArgs({
        binary: "/project/node_modules/wrangler/bin/wrangler.js",
        config: "/project/wrangler.jsonc",
        port: 8787,
        remote: true,
        environment: "staging",
      }),
    ).toEqual([
      "/project/node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--config",
      "/project/wrangler.jsonc",
      "--ip",
      "127.0.0.1",
      "--port",
      "8787",
      "--show-interactive-dev-session=false",
      "--remote",
      "--env",
      "staging",
    ]);
    expect(() => assertCloudflareAgentNodeVersion("21.7.0")).toThrow("Node.js 22 or newer");
    expect(() => assertCloudflareAgentNodeVersion("22.0.0")).not.toThrow();
  });
});

describe("Cloudflare Agents build output", () => {
  it("rejects a Wrangler config that resolves outside the project", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "farm-cf-agent-symlink-"));
    const root = join(temporaryRoot, "project");
    const externalDirectory = join(temporaryRoot, "external");
    await mkdir(root);
    await mkdir(externalDirectory);
    await writeFile(join(externalDirectory, "wrangler.jsonc"), '{"main":"agent.mjs"}\n');
    await symlink(externalDirectory, join(root, "cloudflare"), "junction");

    await expect(
      writeCloudflareAgentOutput({
        root,
        outputDir: ".output",
        config: "cloudflare/wrangler.jsonc",
        routePrefix: "/agents",
      }),
    ).rejects.toThrow("including through symlinks");

    await expect(
      access(join(externalDirectory, ".farm-cf-agent.wrangler.jsonc")),
    ).rejects.toThrow();
  });

  it("composes agent and Farm handlers without changing the user's config", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-cf-agent-"));
    const outputDir = join(root, ".output");
    const configPath = join(root, "wrangler.jsonc");
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(outputDir, "server"), { recursive: true });
    await mkdir(join(outputDir, "public"), { recursive: true });
    await writeFile(
      configPath,
      `{
        // The generated config must preserve user bindings.
        "name": "farm-agent",
        "main": "src/agent.mjs",
        "compatibility_date": "2026-07-16",
        "durable_objects": { "bindings": [{ "name": "CounterAgent", "class_name": "CounterAgent" }] },
      }\n`,
    );
    await writeFile(
      join(root, "src", "agent.mjs"),
      `export class CounterAgent {}
export default { fetch() { return new Response("agent"); } };
`,
    );
    await writeFile(
      join(outputDir, "server", "index.mjs"),
      `export default { fetch() { return new Response("farm"); } };
`,
    );

    const result = await writeCloudflareAgentOutput({
      root,
      outputDir,
      config: "wrangler.jsonc",
      routePrefix: "/agents",
    });

    const original = await readFile(configPath, "utf8");
    expect(original).toContain("The generated config must preserve user bindings");
    const generated = parse(await readFile(result.configPath, "utf8"));
    expect(generated.main).toBe("./.farm/cf-agent/worker.mjs");
    expect(generated.compatibility_flags).toContain("nodejs_compat");
    expect(generated.assets.directory).toBe("./.output/public");
    expect(generated.durable_objects.bindings[0].class_name).toBe("CounterAgent");

    // decodeURI because Vite resolves this id itself and fails on a percent-encoded
    // path, which a Windows short name such as RUNNER~1 produces.
    const wrapperUrl = decodeURI(pathToFileURL(result.wrapperPath).href);
    const module = await import(`${wrapperUrl}?test=${Date.now()}`);
    expect(
      module.default.fetch(new Request("https://example.com/agents/counter/default")),
    ).toMatchObject({ status: 200 });
    expect(
      await (
        await module.default.fetch(new Request("https://example.com/agents/counter/default"))
      ).text(),
    ).toBe("agent");
    expect(
      await (await module.default.fetch(new Request("https://example.com/dashboard"))).text(),
    ).toBe("farm");
    expect(module.CounterAgent).toBeTypeOf("function");

    const metadata = JSON.parse(await readFile(result.metadataPath, "utf8"));
    expect(metadata).toEqual({
      version: 1,
      provider: "cloudflare-agents",
      config: ".farm-cf-agent.wrangler.jsonc",
    });
    await expect(access(join(root, "wrangler.jsonc"))).resolves.toBeUndefined();
  });

  it("rewrites an environment-level main to the combined worker", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-cf-agent-env-"));
    const outputDir = join(root, ".output");
    const configPath = join(root, "wrangler.jsonc");
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(outputDir, "server"), { recursive: true });
    await mkdir(join(outputDir, "public"), { recursive: true });
    await writeFile(
      configPath,
      `{
        "name": "farm-agent",
        "main": "src/agent.mjs",
        "compatibility_date": "2026-07-16",
        "env": {
          "staging": { "main": "src/agent.staging.mjs" }
        }
      }\n`,
    );
    await writeFile(
      join(root, "src", "agent.mjs"),
      `export default { fetch() { return new Response("agent"); } };\n`,
    );
    await writeFile(
      join(root, "src", "agent.staging.mjs"),
      `export default { fetch() { return new Response("staging-agent"); } };\n`,
    );
    await writeFile(
      join(outputDir, "server", "index.mjs"),
      `export default { fetch() { return new Response("farm"); } };\n`,
    );

    const result = await writeCloudflareAgentOutput({
      root,
      outputDir,
      config: "wrangler.jsonc",
      routePrefix: "/agents",
      environment: "staging",
    });

    const generated = parse(await readFile(result.configPath, "utf8"));
    // Both the top-level and the selected env main must point at the wrapper,
    // otherwise `wrangler deploy --env staging` serves only the agent Worker.
    expect(generated.main).toBe("./.farm/cf-agent/worker.mjs");
    expect(generated.env.staging.main).toBe("./.farm/cf-agent/worker.mjs");
  });

  describe("environment bindings", () => {
    // Wrangler does not inherit `durable_objects` into an environment, so these
    // cases are about what the selected env resolves to on its own.
    const scaffold = async (config: string) => {
      const root = await mkdtemp(join(tmpdir(), "farm-cf-agent-bindings-"));
      const outputDir = join(root, ".output");
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(outputDir, "server"), { recursive: true });
      await mkdir(join(outputDir, "public"), { recursive: true });
      await writeFile(join(root, "wrangler.jsonc"), config);
      await writeFile(
        join(root, "src", "agent.mjs"),
        `export class CounterAgent {}
export default { fetch() { return new Response("agent"); } };
`,
      );
      await writeFile(
        join(outputDir, "server", "index.mjs"),
        `export default { fetch() { return new Response("farm"); } };\n`,
      );
      return { root, outputDir };
    };

    const write = (project: { root: string; outputDir: string }, environment?: string) =>
      writeCloudflareAgentOutput({
        root: project.root,
        outputDir: project.outputDir,
        config: "wrangler.jsonc",
        routePrefix: "/agents",
        ...(environment ? { environment } : {}),
      });

    it("refuses an environment that would deploy with no Durable Object bindings", async () => {
      const project = await scaffold(
        `{
          "name": "farm-agent",
          "main": "src/agent.mjs",
          "compatibility_date": "2026-07-16",
          "durable_objects": { "bindings": [{ "name": "CounterAgent", "class_name": "CounterAgent" }] },
          "env": { "staging": { "vars": { "TIER": "staging" } } }
        }\n`,
      );

      // Wrangler resolves env.staging.durable_objects to `{ bindings: [] }` and
      // only warns, so the deploy would succeed and every agent request fail.
      await expect(write(project, "staging")).rejects.toThrow(
        /env\.staging declares no Durable Object bindings/,
      );
      // The message must carry the bindings to copy, not just the diagnosis.
      await expect(write(project, "staging")).rejects.toThrow(/"class_name":"CounterAgent"/);
    });

    it("accepts an environment that declares its own bindings", async () => {
      const project = await scaffold(
        `{
          "name": "farm-agent",
          "main": "src/agent.mjs",
          "compatibility_date": "2026-07-16",
          "durable_objects": { "bindings": [{ "name": "CounterAgent", "class_name": "CounterAgent" }] },
          "env": {
            "staging": {
              "durable_objects": { "bindings": [{ "name": "CounterAgent", "class_name": "StagingCounter" }] }
            }
          }
        }\n`,
      );

      const result = await write(project, "staging");
      const generated = parse(await readFile(result.configPath, "utf8"));
      // The environment's own topology is the user's call and stays untouched.
      expect(generated.env.staging.durable_objects.bindings[0].class_name).toBe("StagingCounter");
      expect(generated.durable_objects.bindings[0].class_name).toBe("CounterAgent");
    });

    it("leaves a project that declares no bindings anywhere alone", async () => {
      const project = await scaffold(
        `{
          "name": "farm-agent",
          "main": "src/agent.mjs",
          "compatibility_date": "2026-07-16",
          "env": { "staging": {} }
        }\n`,
      );

      // Nothing is being dropped here, so this is not the failure to report.
      await expect(write(project, "staging")).resolves.toMatchObject({
        configPath: expect.any(String),
      });
    });
  });

  it("rejects unbundled Workers because they cannot compose Farm", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-cf-agent-unbundled-"));
    await writeFile(join(root, "wrangler.jsonc"), '{"main":"agent.mjs","no_bundle":true}\n');

    await expect(
      writeCloudflareAgentOutput({
        root,
        outputDir: ".output",
        config: "wrangler.jsonc",
        routePrefix: "/agents",
      }),
    ).rejects.toThrow("requires Wrangler bundling");
  });
});
