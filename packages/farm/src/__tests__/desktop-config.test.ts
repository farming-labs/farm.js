// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig, type FarmUserConfig, type ResolvedFarmConfig } from "../config";
import { resolveFarmDesktopConfig, validateFarmDesktopConfig } from "../desktop/config";
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

beforeEach(() => setPlatform(undefined));
afterEach(async () => {
  setPlatform(previousPlatform);
  delete process.env.FARM_DESKTOP_DATA_DIR;
  delete process.env.FARM_DATA_DIR;
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

  it("fails a web build on a malformed desktop key", async () => {
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
