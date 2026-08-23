// @vitest-environment node

import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs build script without type declarations
import { compileRuntime } from "../../scripts/compile-runtime.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tempRoots = new Set<string>();

async function createFixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "farm-svelte-compile-"));
  tempRoots.add(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await cp(
    path.join(packageRoot, "src", "compat-root.svelte"),
    path.join(root, "src", "compat-root.svelte"),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    [...tempRoots].map(async (root) => {
      await rm(root, { recursive: true, force: true });
      tempRoots.delete(root);
    }),
  );
});

describe("compile-runtime generation", () => {
  it("generates both runtime files", async () => {
    const root = await createFixtureRoot();

    await compileRuntime(root);

    for (const name of ["compat-root.client.ts", "compat-root.server.ts"]) {
      const contents = await readFile(path.join(root, "src", "generated", name), "utf8");
      expect(contents).toContain("Generated from src/compat-root.svelte");
    }
  });

  it("never removes existing generated output while regenerating", async () => {
    const root = await createFixtureRoot();
    await compileRuntime(root);

    // Concurrent build/type-check/test scripts each run compileRuntime; a
    // sibling process may be reading these files at any moment, so the
    // directory must never be wiped.
    const sentinelPath = path.join(root, "src", "generated", "concurrent-reader.txt");
    await writeFile(sentinelPath, "still here\n");

    await compileRuntime(root);

    await expect(readFile(sentinelPath, "utf8")).resolves.toBe("still here\n");
  });

  it("leaves identical output untouched instead of rewriting it", async () => {
    const root = await createFixtureRoot();
    await compileRuntime(root);
    const serverPath = path.join(root, "src", "generated", "compat-root.server.ts");
    const before = await stat(serverPath);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await compileRuntime(root);

    const after = await stat(serverPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("settles concurrent regenerations with complete files", async () => {
    const root = await createFixtureRoot();

    await Promise.all(Array.from({ length: 5 }, () => compileRuntime(root)));

    for (const name of ["compat-root.client.ts", "compat-root.server.ts"]) {
      const contents = await readFile(path.join(root, "src", "generated", name), "utf8");
      expect(contents).toContain("Generated from src/compat-root.svelte");
    }
  });
});
