import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createProductionMiddlewareRunner } from "@farm.js/core/internal/production-runtime";
import { describe, expect, it, vi } from "vitest";
import farmRsc, { defineConfig } from "../index.js";
import { linkRscFixtureDependencies } from "../test-fixture-dependencies.js";

type ConfigHook = (
  config: Record<string, unknown>,
  env: { command: "serve" | "build"; mode: string },
) => Promise<unknown>;

/**
 * Drives the plugin's real config hook, so these cover the plumbing from
 * `farm.config.ts` into the generated entry. The generator's own tests only
 * prove it emits what it is handed.
 */
async function generateEntry(
  userConfig: Record<string, unknown>,
  options: { command?: "serve" | "build"; configSource?: string } = {},
): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-middleware-"));
  try {
    linkRscFixtureDependencies(root);
    if (options.configSource) {
      writeFileSync(path.join(root, "farm.config.ts"), options.configSource);
    }
    const plugin = farmRsc().find((candidate) => candidate.name === "@farm.js/plugin/rsc:config");
    await (plugin!.config as ConfigHook)(
      { root, experimental: { serverComponents: true }, ...userConfig },
      {
        command: options.command ?? "build",
        mode: options.command === "serve" ? "development" : "production",
      },
    );
    return readFileSync(path.join(root, ".farm/rsc-entries/entry.rsc.tsx"), "utf8");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("middleware options reach the generated RSC entry", () => {
  it("resolves i18n from the user config", async () => {
    const entry = await generateEntry({
      i18n: { locales: ["en", "de"], defaultLocale: "en", routing: "prefix" },
    });

    // Middleware path matching strips the locale prefix, so without this a
    // `/de/dashboard` request never matches a `/dashboard` middleware.
    expect(entry).toContain('"enabled":true');
    expect(entry).toContain('"locales":["en","de"]');
    expect(entry).toContain('"routing":"prefix"');
  });

  it("carries server.trustProxy from the user config", async () => {
    const entry = await generateEntry({ server: { trustProxy: true } });
    expect(entry).toContain('server: {"trustProxy":true}');
  });

  it("hands the connection's client address to middleware", async () => {
    const entry = await generateEntry({});
    // The Nitro handler passes it in the fetch context; the Request it rebuilt
    // has no socket, so without this the default rate-limit key has nothing.
    expect(entry).toContain("handleFarmRequest(request, context)");
    expect(entry).toContain(
      "farmMiddlewareRunner(request, { clientAddress: context?.clientAddress })",
    );
    expect(entry).toContain("await executeMiddleware(request, context)");
  });

  it("does not invent trustProxy for an app that never set it", async () => {
    const entry = await generateEntry({});
    expect(entry).toContain('server: {"trustProxy":false}');
    // i18n still resolves, just disabled, which is what core resolves too.
    expect(entry).toContain('"enabled":false');
  });

  it.each(["serve", "build"] as const)(
    "imports live config middleware into the %s entry",
    async (command) => {
      const entry = await generateEntry(
        {
          middleware: {
            matcher: /^\/private/,
            handler() {},
          },
        },
        {
          command,
          configSource: `import { defineConfig } from "@farm.js/core";
export default defineConfig({
  middleware: {
    matcher: /^\\/private/,
    handler(context) {
      context.headers.set("x-config-middleware", "active");
    },
  },
});`,
        },
      );

      expect(entry).toMatch(
        /import \* as FarmMiddlewareConfigModule0 from ".*farm\.config\.ts\?farm-rsc-middleware";/,
      );
      expect(entry).toContain("config: farmConfigMiddleware");
    },
  );

  it("fails loudly when live config middleware has no importable config module", async () => {
    await expect(
      generateEntry({ middleware: { matcher: "/private", handler() {} } }),
    ).rejects.toThrow(/requires an importable farm\.config or vite\.config file/);
  });
});

describe("defineConfig({ middleware }) from @farm.js/plugin/rsc", () => {
  const guard = {
    matcher: "/admin/:path*",
    handler: () => new Response("Unauthorized", { status: 401 }),
  };
  const viteConfigSource = `import { defineConfig } from "@farm.js/plugin/rsc";
export default defineConfig({
  srcDir: "src",
  middleware: {
    matcher: "/admin/:path*",
    handler: () => new Response("Unauthorized", { status: 401 }),
  },
});`;

  it("guards the generated production entry", async () => {
    const userConfig = defineConfig({ middleware: guard }) as Record<string, unknown>;
    expect(userConfig.middleware).toBe(guard);

    const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-define-config-middleware-"));
    try {
      linkRscFixtureDependencies(root);
      writeFileSync(path.join(root, "vite.config.ts"), viteConfigSource);
      const plugins = farmRsc();
      const configPlugin = plugins.find((plugin) => plugin.name === "@farm.js/plugin/rsc:config");
      await (configPlugin!.config as ConfigHook)(
        { ...userConfig, root, plugins: undefined },
        { command: "build", mode: "production" },
      );
      const entry = readFileSync(path.join(root, ".farm/rsc-entries/entry.rsc.tsx"), "utf8");
      const moduleId = entry.match(
        /import \* as FarmMiddlewareConfigModule0 from "(.*vite\.config\.ts\?farm-rsc-middleware)";/,
      )?.[1];
      expect(moduleId).toBeTruthy();
      expect(entry).toContain("const farmRuntimeConfigs = [(FarmMiddlewareConfigModule0.default");

      // Run the module the entry imports, as the entry does, through core's runner.
      const loader = plugins.find(
        (plugin) => plugin.name === "@farm.js/plugin/rsc:middleware-config",
      ) as { load(id: string): string | null };
      const modulePath = path.join(root, "extracted-middleware.mjs");
      writeFileSync(modulePath, loader.load(moduleId!)!);
      const extracted = await import(pathToFileURL(modulePath).href);
      const runner = createProductionMiddlewareRunner({ config: extracted.default.middleware });
      const blocked = await runner(new Request("https://example.test/admin/users"));
      expect(blocked.response?.status).toBe(401);
      expect((await runner(new Request("https://example.test/"))).response).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("guards development requests through the standalone middleware plugin", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-define-config-middleware-dev-"));
    try {
      const config = defineConfig({ middleware: guard });
      const middlewarePlugin = (config.plugins as Array<{ name?: string }>).find(
        (plugin) => plugin.name === "@farm.js/core:middleware",
      ) as { configureServer(server: unknown): void };
      const server = {
        config: { root, mode: "development" },
        environments: { ssr: { runner: { import: vi.fn() } } },
        moduleGraph: { invalidateModule: vi.fn() },
        ws: { send: vi.fn() },
      } as Record<string, any>;
      middlewarePlugin.configureServer(server);
      await server.__farmMiddleware__.waitForDiscovery();

      const request = new IncomingMessage(new Socket());
      request.url = "/admin/users";
      request.method = "GET";
      request.headers = { host: "localhost" };
      const response = new ServerResponse(request);
      expect(await server.__farmMiddleware__.execute(request, response)).toBe(true);
      expect(response.statusCode).toBe(401);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
