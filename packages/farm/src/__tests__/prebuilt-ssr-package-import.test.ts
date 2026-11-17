// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerPrebuiltSSRPackageImport } from "../nitro/universal-build";

const dirs: string[] = [];

async function serverDir(packageJSON?: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "farm-ssr-package-import-"));
  dirs.push(dir);
  if (packageJSON) await writeFile(path.join(dir, "package.json"), JSON.stringify(packageJSON));
  return dir;
}

async function readPackage(dir: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("registerPrebuiltSSRPackageImport", () => {
  it("marks the package.json Nitro writes for traced dependencies as ES modules", async () => {
    const dir = await serverDir({ dependencies: { sharp: "0.35.5" } });

    await registerPrebuiltSSRPackageImport(dir, "_virtual_farm-ssr-entry.js", fs);

    expect(await readPackage(dir)).toEqual({
      dependencies: { sharp: "0.35.5" },
      type: "module",
      imports: { "#farm-ssr-entry": "./farm-ssr/_virtual_farm-ssr-entry.js" },
    });
  });

  it("writes an ES module package.json when the server has none", async () => {
    const dir = await serverDir();

    await registerPrebuiltSSRPackageImport(dir, "_virtual_farm-ssr-entry.js", fs);

    expect(await readPackage(dir)).toEqual({
      type: "module",
      imports: { "#farm-ssr-entry": "./farm-ssr/_virtual_farm-ssr-entry.js" },
    });
  });

  it("keeps an explicit type and existing imports", async () => {
    const dir = await serverDir({ type: "commonjs", imports: { "#app": "./app.cjs" } });

    await registerPrebuiltSSRPackageImport(dir, "_virtual_farm-ssr-entry.js", fs);

    expect(await readPackage(dir)).toEqual({
      type: "commonjs",
      imports: {
        "#app": "./app.cjs",
        "#farm-ssr-entry": "./farm-ssr/_virtual_farm-ssr-entry.js",
      },
    });
  });
});
