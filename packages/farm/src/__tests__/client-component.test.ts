import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getClientModuleMetadata,
  isClientComponentModule,
  resolveModuleSourcePath,
  shouldHydrateModule,
} from "../utils/client-component";

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
    fs.writeFileSync(
      sourceFile,
      "'use client';\nexport default function Page() { return null; }\n",
    );

    expect(resolveModuleSourcePath("/src/app/demo/page.tsx", root)).toBe(sourceFile);
    expect(isClientComponentModule("/src/app/demo/page.tsx", root)).toBe(true);
  });

  it("supports absolute module paths directly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-abs-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "page.tsx");
    fs.writeFileSync(
      sourceFile,
      "'use client';\nexport default function Page() { return null; }\n",
    );

    expect(resolveModuleSourcePath(sourceFile, root)).toBe(sourceFile);
    expect(isClientComponentModule(sourceFile, root)).toBe(true);
  });

  it("supports file urls and Vite /@fs/ module ids", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-virtual-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      "'use client';\nexport default function Page() { return null; }\n",
    );

    expect(resolveModuleSourcePath(`file://${sourceFile}`, root)).toBe(sourceFile);
    expect(isClientComponentModule(`file://${sourceFile}`, root)).toBe(true);
    expect(resolveModuleSourcePath(`/@fs${sourceFile}`, root)).toBe(sourceFile);
    expect(isClientComponentModule(`/@fs${sourceFile}`, root)).toBe(true);
  });

  it("supports hydratable server pages through export const hydrate = true", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-hydrate-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      "export const hydrate = true;\nexport default function Page() { return null; }\n",
    );

    expect(getClientModuleMetadata(sourceFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: true,
    });
    expect(isClientComponentModule(sourceFile, root)).toBe(false);
    expect(shouldHydrateModule(sourceFile, root)).toBe(true);
  });

  it("hydrates a server page automatically when it imports a client component", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-import-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "demo", "page.tsx");
    const clientFile = path.join(root, "src", "app", "demo", "home-client.tsx");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(clientFile, '"use client";\nexport function HomeClient() { return null; }\n');
    fs.writeFileSync(
      pageFile,
      'import { HomeClient } from "./home-client";\nexport default function Page() { return <HomeClient />; }\n',
    );

    expect(getClientModuleMetadata(pageFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: true,
    });
    expect(isClientComponentModule(pageFile, root)).toBe(false);
    expect(shouldHydrateModule(pageFile, root)).toBe(true);
  });
});
