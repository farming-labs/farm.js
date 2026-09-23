import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { ModuleNode, ViteDevServer } from "vite";
import { createModuleInspector } from "./modules.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "farm-devtools-test-"));
  roots.push(directory);
  const root = path.join(directory, "app");
  await mkdir(root);
  const graph = new Map<string, ModuleNode>();
  const server = { config: { root }, moduleGraph: { idToModuleMap: graph } } as ViteDevServer;
  async function add(
    relative: string,
    source = "export const value: number = 1;",
    transformed: string | null = "export const value = 1;",
  ) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
    const module = {
      id: file,
      file,
      url: "/" + relative,
      transformResult: transformed === null ? null : { code: transformed },
      importedModules: new Set(),
      importers: new Set(),
    } as unknown as ModuleNode;
    graph.set(file, module);
    return module;
  }
  return { directory, root, graph, server, add, inspector: createModuleInspector(server) };
}
describe("browser module inspector", () => {
  it("returns real source, served output, imports, and importers without transforming", async () => {
    const fixture = await createFixture();
    const module = await fixture.add("src/value.ts");
    module.importedModules.add({ url: "/src/math.ts" } as ModuleNode);
    module.importers.add({ url: "/src/app.tsx" } as ModuleNode);
    const { modules } = await fixture.inspector.list();
    expect(modules).toHaveLength(1);
    expect(modules[0].id).toMatch(/^[a-f0-9]{64}$/);
    expect(await fixture.inspector.read(modules[0].id)).toMatchObject({
      path: "src/value.ts",
      source: "export const value: number = 1;",
      transformed: "export const value = 1;",
      imports: ["/src/math.ts"],
      importers: ["/src/app.tsx"],
    });
  });
  it("does not list SSR-only, dotfiles, dependency, or unsupported files", async () => {
    const f = await fixture();
    await f.add("src/browser.ts");
    await f.add("src/server.ts", "secret", null);
    await f.add(".env.js");
    await f.add(".farm/runtime.ts");
    await f.add("node_modules/vendor/index.js");
    await f.add("src/data.json");
    expect((await f.inspector.list()).modules.map((item) => item.path)).toEqual(["src/browser.ts"]);
  });
  it("rejects arbitrary paths and unknown opaque identifiers", async () => {
    const f = await fixture();
    await f.add("src/value.ts");
    for (const id of ["../../.env", "/src/value.ts", "0".repeat(64)])
      await expect(f.inspector.read(id)).rejects.toMatchObject({ status: 404 });
  });
  it("excludes outside-root symlinks but accepts inside-root source links", async () => {
    const f = await fixture();
    const safe = await f.add("src/safe.ts");
    const outside = path.join(f.directory, "private.ts");
    await writeFile(outside, "DO_NOT_EXPOSE");
    for (const [name, target] of [
      ["outside.ts", outside],
      ["inside.ts", safe.file!],
    ]) {
      const file = path.join(f.root, name);
      await symlink(target, file, "file");
      f.graph.set(file, { ...safe, id: file, file, url: "/" + name } as ModuleNode);
    }
    expect((await f.inspector.list()).modules.map((item) => item.path).sort()).toEqual([
      "inside.ts",
      "src/safe.ts",
    ]);
  });
  it("rechecks symlink containment before reading a previously listed module", async () => {
    const f = await fixture();
    const module = await f.add("src/value.ts");
    const { modules } = await f.inspector.list();
    const outside = path.join(f.directory, "secret.ts");
    await writeFile(outside, "DO_NOT_EXPOSE");
    await rm(module.file!);
    await symlink(outside, module.file!, "file");
    await expect(f.inspector.read(modules[0].id)).rejects.toMatchObject({ status: 404 });
  });
  it("does not use source links to expose hidden paths or dependencies", async () => {
    const f = await fixture();
    const module = await f.add("src/value.ts");
    const { modules } = await f.inspector.list();
    const hidden = await f.add(".private/secret.ts");
    await rm(module.file!);
    await symlink(hidden.file!, module.file!, "file");
    expect((await f.inspector.list()).modules).toEqual([]);
    await expect(f.inspector.read(modules[0].id)).rejects.toMatchObject({ status: 404 });
  });
  it("bounds both source and generated output and handles HMR invalidation", async () => {
    const f = await fixture();
    const module = await f.add("src/value.ts");
    const { modules } = await f.inspector.list();
    await writeFile(module.file!, "x".repeat(1024 * 1024 + 1));
    await expect(f.inspector.read(modules[0].id)).rejects.toMatchObject({ status: 413 });
    await writeFile(module.file!, "small");
    module.transformResult!.code = "x".repeat(1024 * 1024 + 1);
    await expect(f.inspector.read(modules[0].id)).rejects.toMatchObject({ status: 413 });
    module.transformResult = null;
    await expect(f.inspector.read(modules[0].id)).rejects.toMatchObject({ status: 404 });
  });
  it("handles HMR invalidation while checking the source path", async () => {
    const f = await fixture();
    const module = await f.add("src/value.ts");
    const { modules } = await f.inspector.list();
    const reading = f.inspector.read(modules[0].id);
    // read() is waiting on realpath when Vite invalidates the cached transform.
    module.transformResult = null;
    await expect(reading).rejects.toMatchObject({ status: 404 });
  });
});
const createFixture = fixture;
