// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveConfig,
  type FarmDesktopContext,
  type FarmUserConfig,
  type ResolvedFarmConfig,
} from "../config";
import { createServer } from "../server/create-server";
import { stripPlatformConfigSource } from "../build/strip-platform-config";
import { parseAst } from "rolldown/parseAst";
import {
  installFarmDesktopSetup,
  resolveFarmDesktopConfig,
  validateFarmDesktopConfig,
} from "../desktop/config";
import { appDataDir, platform } from "../platform";
import { farmServerOnlyEntriesPlugin } from "../vite";

const roots: string[] = [];
const previousPlatform = process.env.FARM_PLATFORM;

async function appRoot(pkg: Record<string, unknown> = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-desktop-config-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
  return root;
}

function setPlatform(value: string | undefined) {
  if (value === undefined) delete process.env.FARM_PLATFORM;
  else process.env.FARM_PLATFORM = value;
}

beforeEach(() => {
  setPlatform(undefined);
  // What `farm dev|build --desktop` does first. It changes nothing until FARM_PLATFORM says desktop.
  installFarmDesktopSetup({ command: "build" });
});
afterEach(async () => {
  setPlatform(previousPlatform);
  delete process.env.FARM_DESKTOP_DATA_DIR;
  delete process.env.FARM_DATA_DIR;
  delete process.env.FARM_TEST_DESKTOP_FLAG;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

/** Everything a build reads from the resolved config, with functions and the build id dropped. */
function fingerprint(config: ResolvedFarmConfig): string {
  const { deploymentId: _deploymentId, generateBuildId: _generateBuildId, ...rest } = config;
  return JSON.stringify(rest, (_key, value) => (typeof value === "function" ? "fn" : value));
}

describe("desktop config", () => {
  it("rejects unknown keys and malformed values with the option name", () => {
    expect(() => validateFarmDesktopConfig("Notes")).toThrow(/desktop: must be an object/);
    expect(() => validateFarmDesktopConfig({ nmae: "Notes" })).toThrow(/unknown option nmae/);
    expect(() => validateFarmDesktopConfig({ id: "notes" })).toThrow(/reverse-DNS/);
    expect(() => validateFarmDesktopConfig({ window: { width: 10 } })).toThrow(/window.width/);
    expect(() => validateFarmDesktopConfig({ window: { widht: 900 } })).toThrow(
      /unknown option window.widht/,
    );
    expect(() => validateFarmDesktopConfig({ shell: "Electron App" })).toThrow(/adapter name/);
    expect(validateFarmDesktopConfig({ shell: "@acme/desktop-shell" })).toEqual({
      shell: "@acme/desktop-shell",
    });
  });

  it("fills defaults from package.json", async () => {
    const root = await appRoot({ name: "@acme/notes-app", version: "2.3.4" });
    expect(resolveFarmDesktopConfig({}, root)).toEqual({
      name: "notes-app",
      id: "local.farm.notes-app",
      version: "2.3.4",
      window: { width: 1024, height: 768, title: "notes-app" },
      shell: "electrobun",
      shellPackage: "@farm.js/desktop-electrobun",
    });
    expect(
      resolveFarmDesktopConfig(
        { name: "Notes", id: "com.acme.notes", window: { width: 900 }, shell: "@acme/shell" },
        root,
      ),
    ).toMatchObject({
      name: "Notes",
      id: "com.acme.notes",
      window: { width: 900, height: 768, title: "Notes" },
      shellPackage: "@acme/shell",
    });
  });

  it("fails a desktop build on a malformed desktop key", async () => {
    setPlatform("desktop");
    const root = await appRoot();
    await expect(
      resolveConfig({ root, desktop: { window: { height: -1 } } } as FarmUserConfig, "production"),
    ).rejects.toThrow(/window.height/);
  });

  it("resolves to the same web config with or without a desktop key", async () => {
    const root = await appRoot({ name: "notes" });
    const base: FarmUserConfig = { root, deploymentId: "fixed" };
    const without = await resolveConfig(base, "production");
    const withDesktop = await resolveConfig(
      { ...base, desktop: { name: "Notes", window: { width: 900, height: 700 } } },
      "production",
    );
    expect(withDesktop.desktop).toBeNull();
    expect(fingerprint(withDesktop)).toBe(fingerprint(without));
  });

  it("resolves a static block, a sync function, and an async function", async () => {
    setPlatform("desktop");
    const root = await appRoot({ name: "notes" });
    const fromStatic = await resolveConfig({ root, desktop: { name: "Static" } }, "production");
    expect(fromStatic.desktop?.name).toBe("Static");
    const fromSync = await resolveConfig(
      { root, desktop: () => ({ name: "Sync", window: { width: 800 } }) },
      "production",
    );
    expect(fromSync.desktop).toMatchObject({ name: "Sync", window: { width: 800, height: 768 } });
    const fromAsync = await resolveConfig(
      {
        root,
        desktop: async ({ profile }) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { name: `Async ${profile}`, id: "com.example.async" };
        },
      },
      "production",
    );
    expect(fromAsync.desktop).toMatchObject({ name: "Async production", id: "com.example.async" });
  });

  it("passes the context once per loaded block, and only resolved values reach the config", async () => {
    setPlatform("desktop");
    process.env.FARM_TEST_DESKTOP_FLAG = "on";
    installFarmDesktopSetup({ command: "dev", profile: "beta" });
    const root = await appRoot({ name: "notes" });
    const seen: FarmDesktopContext[] = [];
    const desktop = (context: FarmDesktopContext) => {
      seen.push(context);
      return { name: `Notes ${context.profile}`, id: `com.example.notes.${context.profile}` };
    };
    const first = await resolveConfig({ root, desktop }, "development");
    await resolveConfig({ root, desktop }, "development");
    delete process.env.FARM_TEST_DESKTOP_FLAG;

    expect(seen).toHaveLength(1);
    const [context] = seen;
    expect(context).toMatchObject({
      os:
        process.platform === "darwin"
          ? "macos"
          : process.platform === "win32"
            ? "windows"
            : "linux",
      mode: "development",
      command: "dev",
      profile: "beta",
      root,
    });
    expect(context.env.FARM_TEST_DESKTOP_FLAG).toBe("on");
    expect(Object.isFrozen(context.env)).toBe(true);
    expect(first.desktop).toMatchObject({ name: "Notes beta", id: "com.example.notes.beta" });
    // A new function (a dev restart reloads farm.config) is called again.
    await resolveConfig({ root, desktop: (ctx) => desktop(ctx) }, "development");
    expect(seen).toHaveLength(2);
  });

  it("names the OS and field when a returned block is invalid", async () => {
    setPlatform("desktop");
    installFarmDesktopSetup({ command: "build", os: "windows" });
    const root = await appRoot();
    await expect(
      resolveConfig({ root, desktop: () => ({ window: { width: 5 } }) }, "production"),
    ).rejects.toThrow("desktop (os: windows): window.width must be a whole number");
    await expect(
      resolveConfig({ root, desktop: async () => ({ nmae: "x" }) as never }, "production"),
    ).rejects.toThrow("desktop (os: windows): unknown option nmae");
    await expect(
      resolveConfig({ root, desktop: () => null as never }, "production"),
    ).rejects.toThrow("desktop (os: windows): the function must return an object");
    await expect(
      resolveConfig(
        {
          root,
          desktop: () => {
            throw new Error("no signing identity");
          },
        },
        "production",
      ),
    ).rejects.toThrow("no signing identity");
    expect(() => installFarmDesktopSetup({ command: "build", os: "beos" as never })).not.toThrow();
    await expect(resolveConfig({ root, desktop: {} }, "production")).rejects.toThrow(
      /--os must be macos, windows, or linux/,
    );
  });

  it("never calls a function-valued block on the web", async () => {
    const root = await appRoot();
    let calls = 0;
    const desktop = () => {
      calls += 1;
      return { name: "Notes" };
    };
    const config = await resolveConfig({ root, desktop }, "production");
    expect(config.desktop).toBeNull();
    expect(calls).toBe(0);
  });

  it("fails web dev on a malformed static block, without calling a function", async () => {
    const root = await appRoot();
    await fs.writeFile(
      path.join(root, "farm.config.ts"),
      'export default { desktop: { window: { width: "wide" } } };',
    );
    await expect(createServer({ root })).rejects.toThrow(/desktop: window.width must be/);
  });

  it("strips the desktop entry from the config a server bundle imports", () => {
    const parse = (code: string) => parseAst(code);
    expect(
      stripPlatformConfigSource(
        `import { readFileSync } from "node:fs";
export default defineConfig({ plugins: [a], desktop: async ({ root }) => ({ name: readFileSync(root) }), images: {} });`,
        parse,
      ),
    ).toBe(`import { readFileSync } from "node:fs";
export default defineConfig({ plugins: [a], images: {} });`);
    expect(
      stripPlatformConfigSource(`export default { a: 1, desktop: { name: "x" } };`, parse),
    ).toBe("export default { a: 1 };");
    expect(stripPlatformConfigSource(`export default { "desktop": {}, };`, parse)).toBe(
      "export default {  };",
    );
    expect(
      stripPlatformConfigSource(
        `const c = farm.defineConfig({ desktop, x }); export default c;`,
        parse,
      ),
    ).toBe("const c = farm.defineConfig({ x }); export default c;");
    expect(
      stripPlatformConfigSource(
        `import type { FarmDesktopContext } from "@farm.js/core";
export default defineConfig({ desktop: (ctx: FarmDesktopContext) => ({ name: ctx.os }) as const, plugins: [] satisfies unknown[] });`,
        (code) => parseAst(code, { lang: "ts" }),
      ),
    ).toBe(`import type { FarmDesktopContext } from "@farm.js/core";
export default defineConfig({ plugins: [] satisfies unknown[] });`);
    // Nested desktop keys belong to something else.
    expect(
      stripPlatformConfigSource(`export default { theme: { desktop: 1 } };`, parse),
    ).toBeNull();
  });

  it("needs a desktop key for --desktop", async () => {
    setPlatform("desktop");
    const root = await appRoot();
    await expect(resolveConfig({ root }, "production")).rejects.toThrow(
      /--desktop needs a `desktop` entry in farm.config.ts/,
    );
  });

  it("builds for the shell with public-site features off unless the app turns them on", async () => {
    setPlatform("desktop");
    const root = await appRoot({ name: "notes", version: "1.0.0" });
    const config = await resolveConfig(
      { root, desktop: { name: "Notes" }, deploy: { target: "vercel" } },
      "production",
    );
    expect(config.desktop).toMatchObject({ name: "Notes", id: "local.farm.notes" });
    expect(config.preset).toBe("bun");
    expect(config.deploy.preset).toBe("bun");
    expect(config.deploy.outputDir).toBe(path.join(".farm", "output", "desktop", "server"));
    expect(config.images.provider).toBe("none");
    expect(config.agent).toMatchObject({
      jsonLd: false,
      llmsTxt: { enabled: false },
      sitemap: { enabled: false },
      aiCatalog: false,
      manifest: false,
      mcp: false,
    });

    const reEnabled = await resolveConfig(
      {
        root,
        desktop: {},
        images: { provider: "auto" },
        agent: { mcp: true, sitemap: true },
      },
      "production",
    );
    expect(reEnabled.images.provider).toBe("auto");
    expect(reEnabled.agent.mcp).toBe(true);
    expect(reEnabled.agent.sitemap).toMatchObject({ enabled: true });
    expect(reEnabled.agent.llmsTxt).toMatchObject({ enabled: false });
  });
});

describe("@farm.js/core/platform", () => {
  it("reports web and reads FARM_DATA_DIR there", async () => {
    expect(platform()).toBe("web");
    expect(() => appDataDir()).toThrow(/FARM_DATA_DIR/);
    const root = await appRoot();
    process.env.FARM_DATA_DIR = path.join(root, "web-data");
    expect(appDataDir()).toBe(path.join(root, "web-data"));
    await expect(fs.stat(path.join(root, "web-data"))).resolves.toBeTruthy();
  });

  it("reports desktop and returns the shell's data directory, created on use", async () => {
    setPlatform("desktop");
    expect(platform()).toBe("desktop");
    expect(() => appDataDir()).toThrow(/did not pass a data directory/);
    const root = await appRoot();
    process.env.FARM_DATA_DIR = path.join(root, "ignored");
    process.env.FARM_DESKTOP_DATA_DIR = path.join(root, "Application Support", "notes");
    expect(appDataDir()).toBe(path.join(root, "Application Support", "notes"));
    await expect(fs.stat(path.join(root, "Application Support", "notes"))).resolves.toBeTruthy();
  });

  it("gives browser code a literal platform and no node:fs", () => {
    const plugin = farmServerOnlyEntriesPlugin() as any;
    expect(plugin.resolveId("@farm.js/core/platform", "/app/page.tsx", { ssr: true })).toBeNull();
    const id = plugin.resolveId("@farm.js/core/platform", "/app/page.tsx", { ssr: false });
    expect(plugin.load(id)).toContain('return "web";');
    setPlatform("desktop");
    const source: string = plugin.load(id);
    expect(source).toContain('return "desktop";');
    expect(source).not.toContain("node:");
    expect(source).toContain("appDataDir() is server-only");
  });
});
