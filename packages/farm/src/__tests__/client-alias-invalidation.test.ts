import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { getClientModuleMetadata, resolveImportedModule } from "../utils/client-component";
import { FarmSourceSnapshotStore, withFarmSourceSnapshot } from "../utils/source-snapshot";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-alias-invalidation-"));
  roots.push(root);
  let version = 0;
  const write = (file: string, value: unknown) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
    fs.utimesSync(target, 1700000000 + version, 1700000000 + version++);
  };
  const aliases = (dir: string) => ({ compilerOptions: { paths: { "@ui/*": [`./${dir}/*`] } } });
  write("tsconfig.json", { extends: "./base" });
  write("base.json", aliases("client"));
  write("client/widget.tsx", '"use client"; export function Widget() { return null; }');
  write("server/widget.tsx", "export function Widget() { return null; }");
  write(
    "page.tsx",
    'import { Widget } from "@ui/widget"; export default function Page() { return <Widget />; }',
  );
  const page = path.join(root, "page.tsx");
  const resolve = () => resolveImportedModule(page, "@ui/widget", root).path;
  return { root, write, aliases, page, resolve };
}

it.each([false, true])(
  "refreshes inherited aliases and hydration with persistent snapshot=%s",
  (persistent) => {
    const f = fixture();
    const store = persistent ? new FarmSourceSnapshotStore() : undefined;
    f.resolve(); // Warm the global alias cache before dependency tracing starts.
    const inspect = () =>
      withFarmSourceSnapshot(
        () => ({
          path: f.resolve(),
          hydrate: getClientModuleMetadata(f.page, f.root).shouldHydrate,
        }),
        store,
      );
    expect(inspect()).toEqual({ path: path.join(f.root, "client/widget.tsx"), hydrate: true });
    f.write("base.json", f.aliases("server"));
    store?.refresh();
    expect(inspect()).toEqual({ path: path.join(f.root, "server/widget.tsx"), hydrate: false });
  },
);

it.each([false, true])(
  "tracks missing parents through deletion and recreation with snapshot=%s",
  (persistent) => {
    const f = fixture();
    expect(f.resolve()).toBe(path.join(f.root, "client/widget.tsx"));
    const store = persistent ? new FarmSourceSnapshotStore() : undefined;
    const resolve = () => withFarmSourceSnapshot(f.resolve, store);
    resolve();
    fs.unlinkSync(path.join(f.root, "base.json"));
    store?.refresh();
    expect(resolve()).toBeNull();
    f.write("base.json", f.aliases("server"));
    store?.refresh();
    expect(resolve()).toBe(path.join(f.root, "server/widget.tsx"));
  },
);

it("tracks nested and array extends while preserving precedence and cycles", () => {
  const f = fixture();
  f.write("tsconfig.json", { extends: ["./base", "./nested"] });
  f.write("nested.json", { extends: "./deep" });
  f.write("deep.json", { ...f.aliases("server"), extends: "./nested" });
  expect(f.resolve()).toBe(path.join(f.root, "server/widget.tsx"));
  f.write("deep.json", { ...f.aliases("client"), extends: "./nested" });
  expect(f.resolve()).toBe(path.join(f.root, "client/widget.tsx"));
  f.write("nested.json", { extends: "./replacement" });
  f.write("replacement.json", f.aliases("server"));
  expect(f.resolve()).toBe(path.join(f.root, "server/widget.tsx"));
});

it("uses jsconfig parents and notices a root tsconfig appearing", () => {
  const f = fixture();
  fs.renameSync(path.join(f.root, "tsconfig.json"), path.join(f.root, "jsconfig.json"));
  expect(f.resolve()).toBe(path.join(f.root, "client/widget.tsx"));
  f.write("base.json", f.aliases("server"));
  expect(f.resolve()).toBe(path.join(f.root, "server/widget.tsx"));
  f.write("tsconfig.json", f.aliases("client"));
  expect(f.resolve()).toBe(path.join(f.root, "client/widget.tsx"));
});
