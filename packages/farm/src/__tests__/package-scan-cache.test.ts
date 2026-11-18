// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Plugin, UserConfig } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-package-scans-")));
  roots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  }
  return root;
}

/**
 * Runs the plugin's config hook in a fresh copy of Farm's modules, as a new `farm dev` process
 * would, and returns the packages it bundles for the server and the package files it read.
 */
async function startProcess(root: string): Promise<{ bundled: string[]; reads: string[] }> {
  vi.resetModules();
  const { farmServerOnlyEntriesPlugin } = await import("../vite");
  const plugin = farmServerOnlyEntriesPlugin({ distDir: ".farm" }) as Plugin;
  const reads: string[] = [];
  const readFileSync = fs.readFileSync;
  const spy = vi.spyOn(fs, "readFileSync").mockImplementation(function (this: unknown, ...args) {
    const file = String(args[0]);
    if (file.includes(`${path.sep}node_modules${path.sep}`)) reads.push(path.relative(root, file));
    return (readFileSync as (...args: unknown[]) => string | Buffer).apply(this, args);
  });
  try {
    const config = (plugin.config as (config: UserConfig, env: unknown) => UserConfig)(
      { root },
      { command: "serve", mode: "development" },
    );
    const noExternal = (config.ssr?.noExternal ?? []) as string[];
    return { bundled: noExternal.filter((name) => name !== "server-only"), reads };
  } finally {
    spy.mockRestore();
  }
}

describe("package scans", () => {
  it("are saved under distDir and reused by a later process until a scanned file changes", async () => {
    const root = project({
      "node_modules/tweet-kit/package.json": '{"name":"tweet-kit","main":"dist/index.js"}',
      "node_modules/tweet-kit/dist/index.js": 'export * from "./icons.js";\n',
      "node_modules/tweet-kit/dist/icons.js":
        'import s from "./icons.module.css";\nexport const icon = s;\n',
      "src/page.tsx": 'import { icon } from "tweet-kit";\nexport default () => icon;\n',
    });
    const icons = path.join("node_modules", "tweet-kit", "dist", "icons.js");

    const first = await startProcess(root);
    expect(first.bundled).toEqual(["tweet-kit"]);
    expect(first.reads).toContain(icons);
    expect(fs.existsSync(path.join(root, ".farm", "cache", "package-scans.json"))).toBe(true);

    // The package is unchanged: its saved scan applies, and none of its script files is read.
    const second = await startProcess(root);
    expect(second.bundled).toEqual(["tweet-kit"]);
    expect(second.reads).not.toContain(icons);

    // An upgrade that drops the stylesheet import changes the file the scan read.
    fs.writeFileSync(path.join(root, icons), "export const icon = {};\n");
    const third = await startProcess(root);
    expect(third.reads).toContain(icons);
    expect(third.bundled).toEqual([]);
  });

  it("are scanned again when the saved file is unreadable", async () => {
    const root = project({
      "node_modules/tweet-kit/package.json": '{"name":"tweet-kit","main":"index.js"}',
      "node_modules/tweet-kit/index.js": 'import "./a.css";\nexport const icon = 1;\n',
      "src/page.tsx": 'import { icon } from "tweet-kit";\nexport default () => icon;\n',
      ".farm/cache/package-scans.json": "{ not json",
    });
    const scanned = await startProcess(root);
    expect(scanned.bundled).toEqual(["tweet-kit"]);
    expect(scanned.reads).toContain(path.join("node_modules", "tweet-kit", "index.js"));
    const saved = JSON.parse(
      fs.readFileSync(path.join(root, ".farm", "cache", "package-scans.json"), "utf8"),
    );
    expect(Object.keys(saved.scans)).toEqual([path.join(root, "node_modules", "tweet-kit")]);
  });
});
