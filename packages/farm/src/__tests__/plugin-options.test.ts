// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { loadConfig } from "../config";
import { definePlugin, PluginManager, type FarmPlugin } from "../plugin";
import { FarmPluginOptionsError, type FarmPluginOptionsSchema } from "../plugin-options";
import { defineSchema } from "../schema";
import { findSchemaTableOwners } from "../schema-tables";

const securityOptions = z.object({
  frameAncestors: z.string().default("'none'"),
  reportUri: z.url().optional(),
});

// Hooks are typed for plugin authors; tests call them directly.
const runSetup = (plugin: FarmPlugin) => plugin.setup?.({} as never);

describe("definePlugin options", () => {
  it("returns the same plugin object when no options are declared", () => {
    const plugin = { name: "acme:plain" };
    expect(definePlugin(plugin)).toBe(plugin);
  });

  it("makes the parsed options the plugin's state when there is no setup", async () => {
    const security = definePlugin({ name: "acme:security", options: securityOptions });

    await expect(runSetup(security({ frameAncestors: "'self'" }))).toEqual({
      frameAncestors: "'self'",
    });
    await expect(runSetup(security())).toEqual({ frameAncestors: "'none'" });
  });

  it("passes the parsed options to setup, whose result becomes the state", async () => {
    const setup = vi.fn(({ options }: { options: { frameAncestors: string } }) => ({
      header: `frame-ancestors ${options.frameAncestors}`,
    }));
    const security = definePlugin({ name: "acme:security", options: securityOptions, setup });

    expect(await runSetup(security())).toEqual({ header: "frame-ancestors 'none'" });
    expect(setup.mock.calls[0]![0].options).toEqual({ frameAncestors: "'none'" });
  });

  it("keeps the options as state when setup returns nothing, synchronously or not", async () => {
    const sync = definePlugin({ name: "acme:sync", options: securityOptions, setup: () => {} });
    const async = definePlugin({
      name: "acme:async",
      options: securityOptions,
      setup: async () => {},
    });

    expect(runSetup(sync())).toEqual({ frameAncestors: "'none'" });
    await expect(runSetup(async())).resolves.toEqual({ frameAncestors: "'none'" });
  });

  it("passes the parsed options to configure", async () => {
    const security = definePlugin({
      name: "acme:security",
      options: securityOptions,
      configure: (config, { options }) => ({ ...config, basePath: `/${options.frameAncestors}` }),
    });
    const configured = await security({ frameAncestors: "self" }).configure?.({}, {} as never);
    expect(configured).toEqual({ basePath: "/self" });
  });

  it("hands state built from options to hooks through the plugin manager", async () => {
    const seen: unknown[] = [];
    const security = definePlugin({
      name: "acme:security",
      options: securityOptions,
      router: {
        generated(_routes, { state }) {
          seen.push(state);
        },
      },
    });
    const manager = new PluginManager({ config: {}, isDev: true, isProd: false });
    manager.addPlugin(security({ frameAncestors: "'self'" }));
    await manager.setupPlugins();
    await manager.runHookParallel("routesGenerated", { routes: [] } as never);

    expect(seen).toEqual([{ frameAncestors: "'self'" }]);
  });

  it("rejects invalid options before the plugin is created, naming each problem", () => {
    const setup = vi.fn();
    const security = definePlugin({ name: "acme:security", options: securityOptions, setup });
    const attempt = () => security({ frameAncestors: 42 as never, reportUri: "not a url" });

    expect(attempt).toThrow(FarmPluginOptionsError);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/^Invalid plugin options:/);
      expect(message).toContain("frameAncestors:");
      expect(message).toContain("reportUri:");
      expect((error as FarmPluginOptionsError).issues).toHaveLength(2);
    }
    expect(setup).not.toHaveBeenCalled();
  });

  it("works with any Standard Schema, not only Zod", () => {
    const portSchema: FarmPluginOptionsSchema<{ port?: number }, { port: number }> = {
      "~standard": {
        version: 1,
        vendor: "hand-written",
        validate(value) {
          const port = (value as { port?: unknown }).port ?? 4000;
          return typeof port === "number"
            ? { value: { port } }
            : { issues: [{ message: "must be a number", path: [{ key: "port" }] }] };
        },
      },
    };
    const portPlugin = definePlugin({ name: "acme:port", options: portSchema });

    expect(runSetup(portPlugin())).toEqual({ port: 4000 });
    expect(() => portPlugin({ port: "80" as never })).toThrow("port: must be a number");
  });

  it("refuses asynchronous schemas instead of skipping validation", () => {
    const asyncPlugin = definePlugin({
      name: "acme:async",
      options: z.object({ token: z.string() }).refine(async () => true),
    });
    expect(() => asyncPlugin({ token: "x" })).toThrow(/must validate synchronously/);
  });

  it("leaves a plugin whose options value is not a schema untouched", () => {
    // An untyped plugin may already carry its own \`options\` field.
    const legacy = { name: "acme:legacy", options: { retries: 3 } };
    expect(definePlugin(legacy as never)).toBe(legacy);
  });

  it("creates an independent plugin, with its own options, on every call", () => {
    const security = definePlugin({ name: "acme:security", options: securityOptions });
    const first = security({ frameAncestors: "'self'" });
    const second = security();

    expect(first).not.toBe(second);
    expect(runSetup(first)).toEqual({ frameAncestors: "'self'" });
    expect(runSetup(second)).toEqual({ frameAncestors: "'none'" });
  });

  it("fails while the app's config loads, before the server starts", async () => {
    // Inside the package so the config can resolve zod like an app would.
    const root = mkdtempSync(path.join(process.cwd(), ".tmp-plugin-options-"));
    const pluginModule = path.resolve("src/plugin.ts").replace(/\\/g, "/");
    try {
      writeFileSync(
        path.join(root, "farm.config.ts"),
        `import { z } from "zod";
import { definePlugin } from ${JSON.stringify(pluginModule)};

const security = definePlugin({
  name: "acme:security",
  options: z.object({ frameAncestors: z.string() }),
});

export default { plugins: [security({ frameAncestors: 42 })] };
`,
      );
      await expect(loadConfig(root)).rejects.toThrow(
        /Invalid plugin options:\n {2}- frameAncestors:/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still declares the tables, dependencies, and steps of a plugin with options", () => {
    const teams = definePlugin({
      name: "farm:teams",
      version: "1.1.0",
      options: z.object({ seats: z.number().default(5) }),
      schema: defineSchema({
        models: { member: { fields: { id: { type: "string", primaryKey: true } } } },
      }),
      dependsOn: ["farm:auth"],
      migrations: [{ id: "rename-team", renameTable: { from: "team", to: "member" } }],
    });
    const [owner, ...rest] = findSchemaTableOwners({ plugins: [teams()] });
    expect(rest).toEqual([]);
    expect(owner).toMatchObject({
      name: "teams",
      version: "1.1.0",
      dependsOn: ["auth"],
      models: ["member"],
      migrations: [{ id: "rename-team" }],
    });
  });

  it("rejects a schema problem while the config loads, as plugins without options do", () => {
    const broken = definePlugin({
      name: "farm:teams",
      options: z.object({}),
      migrations: [{ id: "x", renameTable: { from: "a", to: "b" } }],
    });
    expect(() => broken()).toThrow(/sets `migrations` without a `schema`/);
  });
});
