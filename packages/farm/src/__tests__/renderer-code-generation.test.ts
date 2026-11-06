// @vitest-environment node

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { rolldown } from "rolldown";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "../..");
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("server renderer", () => {
  it("loads where code generation from strings is disallowed", async () => {
    // Inside the package so the bundle's bare imports resolve from its node_modules.
    const dir = await mkdtemp(path.join(packageRoot, ".tmp-renderer-codegen-"));
    dirs.push(dir);
    const bundle = await rolldown({
      input: path.join(packageRoot, "src/server/renderer.ts"),
      external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
      logLevel: "silent",
    });
    await bundle.write({ dir, format: "esm", entryFileNames: "renderer.mjs" });
    await bundle.close();

    const { stdout } = await execFileAsync(process.execPath, [
      "--disallow-code-generation-from-strings",
      "--input-type=module",
      "--eval",
      "const renderer = await import(process.argv[1]); process.stdout.write(typeof renderer.ServerRenderer);",
      pathToFileURL(path.join(dir, "renderer.mjs")).href,
    ]);
    expect(stdout).toBe("function");
  }, 60_000);
});
