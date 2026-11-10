import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopShellContext } from "@farm.js/core/desktop";
import shell, { DEFAULT_ICON, resolveElectrobunCli } from "./index";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function context(root: string, overrides: Partial<DesktopShellContext> = {}): DesktopShellContext {
  return {
    root,
    basePath: "",
    shellDir: path.join(root, ".farm", "output", "desktop", "shell"),
    serverDir: path.join(root, ".farm", "output", "desktop", "server"),
    desktop: {
      name: "Farm Notes",
      id: "dev.farmjs.examples.notes",
      version: "1.2.3",
      window: { width: 900, height: 700, title: "Notes" },
      shell: "electrobun",
      shellPackage: "@farm.js/desktop/electrobun",
    },
    ...overrides,
  };
}

async function generated(ctx: DesktopShellContext): Promise<Record<string, string>> {
  return Object.fromEntries(
    (await shell.generateMain(ctx)).flatMap((file) =>
      typeof file.contents === "string" ? [[file.path, file.contents]] : [],
    ),
  );
}

async function generatedIcon(ctx: DesktopShellContext): Promise<Uint8Array | string | undefined> {
  return (await shell.generateMain(ctx)).find((file) => file.path.endsWith(".png"))?.contents;
}

describe("@farm.js/desktop/electrobun", () => {
  it("is a Bun shell", () => {
    expect(shell.name).toBe("electrobun");
    expect(shell.runtime).toBe("bun");
  });

  it("generates the Electrobun config from the desktop config", async () => {
    const files = await generated(context("/app"));
    const source = files["electrobun.config.ts"];
    const config = JSON.parse(source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1));
    expect(config).toEqual({
      app: { name: "Farm Notes", identifier: "dev.farmjs.examples.notes", version: "1.2.3" },
      build: {
        bun: { entrypoint: "main.ts" },
        copy: { "../server": "farm" },
        mac: { bundleCEF: false, createDmg: false, icons: "icon.iconset" },
        linux: { bundleCEF: false },
        win: { bundleCEF: false },
      },
      runtime: { exitOnLastWindowClosed: true },
    });
  });

  it("starts the server through start() and opens the window at the handshake", async () => {
    const files = await generated(context("/app", { basePath: "/notes" }));
    const main = files["main.ts"];
    const output = ts.transpileModule(main, {
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    expect(output.diagnostics).toEqual([]);
    expect(main).toContain('from "electrobun/main"');
    expect(main).toContain("const { start } = await import(entry);");
    expect(main).toContain("start({ secret, handshakeToken, dataDir })");
    expect(main).toContain("Utils.paths.userData");
    expect(main).toContain('"serverEntry": "farm/server/index.mjs"');
    expect(main).toContain('"basePath": "/notes"');
    expect(main).toContain('const HANDSHAKE_PATH = "/__farm/desktop/handshake";');
    expect(main).toContain('setNavigationRules(["^*", farm.origin + "/*"])');
    // Page content gets no Electrobun RPC (Electrobun defaults to sandbox: false).
    expect(/new BrowserWindow\(\{([^}]|\{[^}]*\})*\}\)/.exec(main)?.[0]).toMatch(
      /\n  sandbox: true,\n/,
    );
    expect(main).toContain("Utils.openExternal(url)");
    expect(main).toContain('Electrobun.events.on("before-quit"');
    // The token never reaches the shell's logs.
    expect(main).not.toMatch(/console\.log\([^)]*handshakeToken/);
    expect(main).toContain("const farmDesktopHooks = {};");
  });

  it("imports src/desktop.ts relative to the shell project", async () => {
    const files = await generated(context("/app", { hooksFile: "/app/src/desktop.ts" }));
    expect(files["main.ts"]).toContain(
      'import farmDesktopHooks from "../../../../src/desktop.ts";',
    );
    expect(files["main.ts"]).toContain("await farmDesktopHooks.onReady?.(");
  });

  it("writes the Farm icon into the icon set unless the app sets desktop.icon", async () => {
    const files = (await shell.generateMain(context("/app"))).map((file) => file.path);
    expect(files).toContain("icon.iconset/icon_512x512@2x.png");
    expect(Buffer.from((await generatedIcon(context("/app"))) as Uint8Array)).toEqual(
      await readFile(DEFAULT_ICON),
    );

    const root = await mkdtemp(path.join(os.tmpdir(), "farm-electrobun-"));
    roots.push(root);
    const icon = path.join(root, "app-icon.png");
    await writeFile(icon, "app icon bytes");
    const base = context(root);
    const appIcon = await generatedIcon({ ...base, desktop: { ...base.desktop, icon } });
    expect(Buffer.from(appIcon as Uint8Array).toString()).toBe("app icon bytes");
  });

  it("says how to install electrobun when it is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "farm-electrobun-"));
    roots.push(root);
    await writeFile(path.join(root, "package.json"), "{}");
    expect(() => resolveElectrobunCli(root)).toThrow(/pnpm add -D electrobun/);
    const cli = path.join(root, "node_modules", "electrobun", "bin", "electrobun.cjs");
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, "");
    expect(resolveElectrobunCli(path.join(root, "nested"))).toBe(cli);
  });
});
