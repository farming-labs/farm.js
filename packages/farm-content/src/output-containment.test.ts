import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collection, content, files } from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "farm-content-output-"));
  roots.push(directory);
  const root = path.join(directory, "app");
  const outside = path.join(directory, "app-other");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(path.join(root, "post.md"), "---\ntitle: Safe\n---\nBody");
  const configure = async (appRoot = root) => {
    const plugin = content({
      collections: {
        posts: collection({
          source: files("post.md"),
          schema: { parse: (data) => data },
        }),
      },
    });
    return plugin.configure?.(
      { root: appRoot, plugins: [plugin] },
      { config: {} as never, isDev: true, isProd: false },
    );
  };
  return { directory, root, outside, configure };
}

describe("content generated output containment", () => {
  it.each([".farm", ".farm/content"])(
    "rejects an outside %s link before creating output",
    async (relative) => {
      const { root, outside, configure } = await fixture();
      const link = path.join(root, relative);
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(outside, link, "junction");
      await expect(configure()).rejects.toThrow(
        "Generated content output must stay inside the Farm project root",
      );
      expect(await readdir(outside)).toEqual([]);
    },
  );

  it.each([false, true])(
    "rejects a destination file symlink (dangling: %s) without modifying its target",
    async (dangling) => {
      const { root, outside, configure } = await fixture();
      await mkdir(path.join(root, ".farm", "content"), { recursive: true });
      const target = path.join(outside, "sentinel.mjs");
      if (!dangling) await writeFile(target, "keep");
      await symlink(target, path.join(root, ".farm", "content", "server.mjs"), "file");
      await expect(configure()).rejects.toThrow(
        "Generated content output must stay inside the Farm project root",
      );
      if (dangling) expect(await readdir(outside)).toEqual([]);
      else expect(await readFile(target, "utf8")).toBe("keep");
    },
  );

  it("rejects a dangling directory link without creating its target", async () => {
    const { root, outside, configure } = await fixture();
    await symlink(path.join(outside, "missing"), path.join(root, ".farm"), "junction");
    await expect(configure()).rejects.toThrow(
      "Generated content output must stay inside the Farm project root",
    );
    expect(await readdir(outside)).toEqual([]);
  });

  it("allows a symlinked app root and output directories within that root", async () => {
    const { directory, root, configure } = await fixture();
    const alias = path.join(directory, "app-alias");
    await symlink(root, alias, "junction");
    await mkdir(path.join(root, "generated"));
    await symlink(path.join(root, "generated"), path.join(root, ".farm"), "junction");
    await configure(alias);
    expect(await readFile(path.join(root, "generated", "content", "server.mjs"), "utf8")).toContain(
      "createContentRuntime",
    );
  });
});
