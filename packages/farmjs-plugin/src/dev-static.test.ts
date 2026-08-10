import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { devServableFileExists } from "./dev-static.js";

describe("devServableFileExists", () => {
  let root: string;
  let publicDir: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "farmjs-plugin-dev-static-"));
    publicDir = path.join(root, "public");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(path.join(root, "src", "main.tsx"), "export {};\n");
    fs.writeFileSync(path.join(publicDir, "favicon.ico"), "icon");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns true for real files, false for dotted route paths", () => {
    expect(devServableFileExists("/src/main.tsx", [publicDir, root])).toBe(true);
    expect(devServableFileExists("/favicon.ico", [publicDir, root])).toBe(true);
    expect(devServableFileExists("/kinfish/farm.js", [publicDir, root])).toBe(false);
  });

  it("returns false for directories and traversal attempts", () => {
    expect(devServableFileExists("/src", [publicDir, root])).toBe(false);
    expect(devServableFileExists("/../etc/passwd", [publicDir, root])).toBe(false);
  });
});
