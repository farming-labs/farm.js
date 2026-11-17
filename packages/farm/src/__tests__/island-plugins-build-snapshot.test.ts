// @vitest-environment node
import fs from "fs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build } from "vite";
import { farmEnvironmentFunctionsPlugin } from "../environment-vite";
import { FarmSourceSnapshotStore } from "../utils/source-snapshot";
import { farmIslandContainersPlugin } from "../vite";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Two server modules render the same client component: without a shared snapshot, each
// transform reads and resolves the component again.
const files: Record<string, string> = {
  "src/components/button.tsx": '"use client";\nexport function Button() { return null; }\n',
  "src/a.tsx":
    'import { Button } from "./components/button";\nexport default function A() { return <div><Button /></div>; }\n',
  "src/b.tsx":
    'import { Button } from "./components/button";\nexport default function B() { return <div><Button /></div>; }\n',
  "src/entry.ts": 'export * as a from "./a";\nexport * as b from "./b";\n',
  "package.json": '{"name":"app","type":"module"}',
};

async function buildWith(sourceSnapshot?: FarmSourceSnapshotStore) {
  const root = fs.realpathSync(mkdtempSync(path.join(tmpdir(), "farm-island-snapshot-")));
  roots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  }
  const config = { root, experimental: { serverComponents: "islands" as const }, sourceSnapshot };
  const reads = vi.spyOn(fs, "readFileSync");
  await build({
    root,
    logLevel: "silent",
    plugins: [farmIslandContainersPlugin(config), farmEnvironmentFunctionsPlugin(config)],
    build: {
      ssr: true,
      write: false,
      minify: false,
      rollupOptions: { input: path.join(root, "src/entry.ts"), external: [/^react/] },
    },
  });
  const component = path.join(root, "src/components/button.tsx");
  return reads.mock.calls.filter(([file]) => file === component).length;
}

describe("island plugins in a production build", () => {
  it("read a shared client component once when the build hands them its plan snapshot", async () => {
    const withoutSnapshot = await buildWith();
    const withSnapshot = await buildWith(new FarmSourceSnapshotStore(false));
    expect(withoutSnapshot).toBeGreaterThan(1);
    expect(withSnapshot).toBe(1);
  });
});
