import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { toFileModuleUrl } from "../utils/file-module";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("filesystem module loading", () => {
  it("encodes URL-reserved characters before importing a filesystem module", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm modules#"));
    tempDirs.push(root);

    const modulePath = path.join(root, "route module.mjs");
    await fs.writeFile(modulePath, "export const marker = 'loaded';\n");

    const moduleUrl = toFileModuleUrl(modulePath);
    expect(moduleUrl).toContain("farm%20modules%23");
    expect(moduleUrl).toContain("route%20module.mjs");

    const { stdout } = await execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      "const loaded = await import(process.argv[1]); process.stdout.write(loaded.marker);",
      moduleUrl,
    ]);
    expect(stdout).toBe("loaded");
  });
});
