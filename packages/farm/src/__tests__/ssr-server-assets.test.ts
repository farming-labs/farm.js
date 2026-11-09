// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Rollup } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertServerFileAssetsDeployable,
  copyServerFileAssetsBesideChunks,
} from "../nitro/ssr-server-assets";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => fs.rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

async function serverOutput(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-ssr-server-assets-"));
  temporaryRoots.add(root);
  for (const [fileName, contents] of Object.entries(files)) {
    const filePath = path.join(root, fileName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents);
  }
  return root;
}

function bundleOf(...assets: Array<[string, string | Uint8Array]>): Rollup.OutputBundle {
  return Object.fromEntries(
    assets.map(([fileName, source]) => [
      fileName,
      { type: "asset", fileName, source } as Rollup.OutputAsset,
    ]),
  );
}

describe("copyServerFileAssetsBesideChunks", () => {
  it("writes each asset where the chunk that reads it resolves its URL", async () => {
    const bundle = bundleOf(
      ["assets/math-abc.wasm", Uint8Array.from([0, 97, 115, 109])],
      ["assets/data-def.bin", "data"],
      ["assets/page-ghi.png", "png"],
    );
    const serverDir = await serverOutput({
      "index.mjs": `const url = new URL("assets/math-abc.wasm", import.meta.url).href;`,
      // Minified into a nested chunk: the relative URL keeps the SSR bundle's layout.
      "chunks/_/route.mjs": "x=new URL(`assets/data-def.bin?raw`,import.meta.url)",
      // Copied runtime packages resolve their own files.
      "node_modules/pkg/index.js": `new URL("assets/math-abc.wasm", import.meta.url)`,
      "notes.txt": `new URL("assets/page-ghi.png", import.meta.url)`,
    });

    const copied = await copyServerFileAssetsBesideChunks(
      bundle,
      new Set(["assets/math-abc.wasm", "assets/data-def.bin"]),
      serverDir,
      fs,
    );

    expect(copied).toEqual(["assets/math-abc.wasm", "chunks/_/assets/data-def.bin"]);
    await expect(fs.readFile(path.join(serverDir, "assets/math-abc.wasm"))).resolves.toEqual(
      Buffer.from([0, 97, 115, 109]),
    );
    await expect(
      fs.readFile(path.join(serverDir, "chunks/_/assets/data-def.bin"), "utf8"),
    ).resolves.toBe("data");
    await expect(
      fs.access(path.join(serverDir, "node_modules/pkg/assets/math-abc.wasm")),
    ).rejects.toThrow();
    await expect(fs.access(path.join(serverDir, "assets/page-ghi.png"))).rejects.toThrow();
  });

  it("refuses to write outside the server output", async () => {
    const serverDir = await serverOutput({
      "index.mjs": `new URL("../assets/math-abc.wasm", import.meta.url)`,
    });
    await expect(
      copyServerFileAssetsBesideChunks(
        bundleOf(["assets/math-abc.wasm", "wasm"]),
        new Set(["assets/math-abc.wasm"]),
        serverDir,
        fs,
      ),
    ).rejects.toThrow(/index\.mjs reads assets\/math-abc\.wasm from \.\.\/assets\/math-abc\.wasm/);
    await expect(fs.access(path.join(serverDir, "../assets/math-abc.wasm"))).rejects.toThrow();
  });
});

describe("assertServerFileAssetsDeployable", () => {
  it("accepts presets with a filesystem and builds without server-read assets", () => {
    const assets = new Set(["assets/math-abc.wasm"]);
    for (const preset of ["node-server", "bun", "vercel", "netlify", "aws-lambda"]) {
      expect(() => assertServerFileAssetsDeployable(preset, assets)).not.toThrow();
    }
    expect(() => assertServerFileAssetsDeployable("cloudflare-module", new Set())).not.toThrow();
  });

  it("names the files and the fix for presets without a filesystem", () => {
    expect(() =>
      assertServerFileAssetsDeployable("cloudflare-module", new Set(["assets/math-abc.wasm"])),
    ).toThrow(/refuse to compile WebAssembly from bytes/);
    let message = "";
    try {
      assertServerFileAssetsDeployable(
        "vercel-edge",
        new Set(["assets/math-abc.wasm", "assets/data-def.bin"]),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(
      "The vercel-edge preset cannot deploy files that server code reads from disk: assets/data-def.bin, assets/math-abc.wasm.",
    );
    expect(message).toContain("?inline");
    expect(message).not.toContain("Cloudflare");
  });
});
