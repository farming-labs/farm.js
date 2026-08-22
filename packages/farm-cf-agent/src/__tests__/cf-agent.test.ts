import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
