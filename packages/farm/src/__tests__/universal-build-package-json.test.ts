// @vitest-environment node

import fs, { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePackageJson, stageSharpRuntime } from "../nitro/universal-build";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createPackage(root: string, name: string, manifest: Record<string, unknown>) {
  const directory = path.join(root, "node_modules", ...name.split("/"));
  await mkdir(path.join(directory, "export"), { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, ...manifest }));
  await writeFile(path.join(directory, "index.js"), "module.exports = {};\n");
  await writeFile(path.join(directory, "export", "package.cjs"), "module.exports = {};\n");
  return directory;
}

describe("staged package metadata", () => {
  it("finds the manifest of a package whose ./package export is a module", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "farm-package-json-")));
    roots.push(root);
    await writeFile(path.join(root, "package.json"), '{"name":"app"}');
    // The shape of @img/sharp-freebsd-wasm32 0.35: no package.json export, ./package → .cjs.
    const directory = await createPackage(root, "@img/sharp-wasm32", {
      main: "index.js",
      exports: { ".": "./index.js", "./package": "./export/package.cjs" },
    });

    const resolved = resolvePackageJson(
      createRequire(path.join(root, "package.json")),
      "@img/sharp-wasm32",
    );

    expect(resolved).toBe(path.join(directory, "package.json"));
  });

  it("still uses an exported package.json directly", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "farm-package-json-")));
    roots.push(root);
    await writeFile(path.join(root, "package.json"), '{"name":"app"}');
    const directory = await createPackage(root, "plain-package", { main: "index.js" });

    const resolved = resolvePackageJson(
      createRequire(path.join(root, "package.json")),
      "plain-package",
    );

    expect(resolved).toBe(path.join(directory, "package.json"));
  });
});

describe("Sharp runtime staging", () => {
  // Sharp 0.35's layout, with every platform build installed, as an install that ignores
  // platforms leaves it (Vercel's `pnpm install --force`). The wasm build is reached only
  // through the FreeBSD and WebContainers wrappers.
  const platformPackages: Record<string, Record<string, unknown>> = {
    "@img/sharp-linux-x64": { os: ["linux"], cpu: ["x64"], libc: ["glibc"] },
    "@img/sharp-libvips-linux-x64": { os: ["linux"], cpu: ["x64"], libc: ["glibc"] },
    "@img/sharp-linuxmusl-x64": { os: ["linux"], cpu: ["x64"], libc: ["musl"] },
    "@img/sharp-linux-arm64": { os: ["linux"], cpu: ["arm64"], libc: ["glibc"] },
    "@img/sharp-darwin-arm64": { os: ["darwin"], cpu: ["arm64"] },
    "@img/sharp-win32-x64": { os: ["win32"], cpu: ["x64"] },
    "@img/sharp-freebsd-wasm32": {
      os: ["freebsd"],
      dependencies: { "@img/sharp-wasm32": "0.35.5" },
    },
    "@img/sharp-webcontainers-wasm32": {
      cpu: ["wasm32"],
      dependencies: { "@img/sharp-wasm32": "0.35.5" },
    },
  };

  async function createSharpInstall() {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "farm-sharp-stage-")));
    roots.push(root);
    await writeFile(path.join(root, "package.json"), '{"name":"app"}');
    await createPackage(root, "sharp", {
      version: "0.35.5",
      main: "index.js",
      dependencies: { "@img/colour": "1.0.0" },
      optionalDependencies: Object.fromEntries(
        Object.keys(platformPackages).map((name) => [name, "0.35.5"]),
      ),
    });
    await createPackage(root, "@img/colour", { version: "1.0.0", main: "index.js" });
    await createPackage(root, "@img/sharp-wasm32", { version: "0.35.5", main: "index.js" });
    for (const [name, manifest] of Object.entries(platformPackages)) {
      await createPackage(root, name, { version: "0.35.5", main: "index.js", ...manifest });
    }
    return root;
  }

  it("stages only the builds a Vercel function can load", async () => {
    const root = await createSharpInstall();

    const staged = await stageSharpRuntime({} as never, root, ".farm", fs, "vercel");

    expect(Object.keys(staged.dependencies)).toEqual([
      "@img/colour",
      "@img/sharp-libvips-linux-x64",
      "@img/sharp-linux-x64",
      "sharp",
    ]);
    await expect(
      fs.access(path.join(staged.stageDir, "node_modules", "@img", "sharp-darwin-arm64")),
    ).rejects.toThrow();
  });

  it("keeps every installed build for a preset that runs where it is deployed", async () => {
    const root = await createSharpInstall();

    const staged = await stageSharpRuntime({} as never, root, ".farm", fs, "node-server");

    expect(Object.keys(staged.dependencies)).toEqual(
      [...Object.keys(platformPackages), "@img/colour", "@img/sharp-wasm32", "sharp"].sort(
        (left, right) => left.localeCompare(right),
      ),
    );
  });
});
