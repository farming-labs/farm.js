// @vitest-environment node

import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveVercelOutputPath } from "../nitro/universal-build";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rmTemp(root)));
  temporaryRoots.clear();
});

async function rmTemp(root: string) {
  await fs.rm(root, { recursive: true, force: true });
}

async function createFixture(): Promise<{ src: string; dest: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-vercel-output-"));
  temporaryRoots.add(root);
  const src = path.join(root, "server", "chunks");
  const dest = path.join(root, "functions", "__nitro.func", "chunks");
  await fs.mkdir(src, { recursive: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(path.join(src, "entry.mjs"), "export default 1;\n");
  return { src, dest };
}

describe("moveVercelOutputPath", () => {
  it("moves directories with rename when permitted", async () => {
    const { src, dest } = await createFixture();

    await moveVercelOutputPath(src, dest, fs);

    await expect(fs.readFile(path.join(dest, "entry.mjs"), "utf8")).resolves.toContain("default 1");
    await expect(fs.stat(src)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("falls back to copy-and-remove when rename fails with EPERM", async () => {
    // On Windows, rename fails with EPERM when another process holds a handle
    // on the directory (antivirus, indexing, a running dev server) (#394).
    const { src, dest } = await createFixture();
    const fsWithLockedRename = {
      ...fs,
      rename: async () => {
        throw Object.assign(new Error("EPERM: operation not permitted, rename"), {
          code: "EPERM",
        });
      },
    } as unknown as typeof fs;

    await moveVercelOutputPath(src, dest, fsWithLockedRename);

    await expect(fs.readFile(path.join(dest, "entry.mjs"), "utf8")).resolves.toContain("default 1");
    await expect(fs.stat(src)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rethrows errors the fallback cannot help with", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-vercel-output-"));
    temporaryRoots.add(root);

    await expect(
      moveVercelOutputPath(path.join(root, "missing"), path.join(root, "dest"), fs),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
