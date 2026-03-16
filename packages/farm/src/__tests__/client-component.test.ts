import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { isClientComponentModule, resolveModuleSourcePath } from "../utils/client-component";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("client component path resolution", () => {
  it("resolves project-relative /src module paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-path-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, "'use client';\nexport default function Page() { return null; }\n");

    expect(resolveModuleSourcePath("/src/app/demo/page.tsx", root)).toBe(sourceFile);
    expect(isClientComponentModule("/src/app/demo/page.tsx", root)).toBe(true);
  });

  it("supports absolute module paths directly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-abs-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "page.tsx");
    fs.writeFileSync(sourceFile, "'use client';\nexport default function Page() { return null; }\n");

    expect(resolveModuleSourcePath(sourceFile, root)).toBe(sourceFile);
    expect(isClientComponentModule(sourceFile, root)).toBe(true);
  });

  it("supports file urls and Vite /@fs/ module ids", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-virtual-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, "'use client';\nexport default function Page() { return null; }\n");

    expect(resolveModuleSourcePath(`file://${sourceFile}`, root)).toBe(sourceFile);
    expect(isClientComponentModule(`file://${sourceFile}`, root)).toBe(true);
    expect(resolveModuleSourcePath(`/@fs${sourceFile}`, root)).toBe(sourceFile);
    expect(isClientComponentModule(`/@fs${sourceFile}`, root)).toBe(true);
  });
});
