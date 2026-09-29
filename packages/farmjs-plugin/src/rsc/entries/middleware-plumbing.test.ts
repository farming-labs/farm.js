import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import farmRsc from "../index.js";
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
    ).rejects.toThrow(/requires an importable farm\.config file/);
  });
});
