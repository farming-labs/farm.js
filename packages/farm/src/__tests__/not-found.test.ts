import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../config";
import { resolveFarmNotFoundComponentPath } from "../not-found";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-not-found-"));
  tempDirs.push(root);
  return root;
}

function write(root: string, relativePath: string): string {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "export default function NotFound() { return null; }\n");
  return filePath;
}

describe("resolveFarmNotFoundComponentPath", () => {
  it("prefers an explicitly configured component over the app convention", async () => {
    const root = createRoot();
    write(root, "src/app/not-found.tsx");
    const configured = write(root, "src/ui/missing.tsx");
    const config = await resolveConfig(
      { root, notFound: { component: "./src/ui/missing.tsx" } },
      "development",
    );

    expect(resolveFarmNotFoundComponentPath(config, [path.join(root, "src/app")])).toBe(configured);
  });

  it("fails clearly when the configured component is missing", async () => {
    const root = createRoot();
    const config = await resolveConfig(
      { root, notFound: { component: "./src/ui/missing.tsx" } },
      "production",
    );

    expect(() => resolveFarmNotFoundComponentPath(config, [path.join(root, "src/app")])).toThrow(
      `notFound.component was not found: ${path.join(root, "src/ui/missing.tsx")}`,
    );
  });

  it("rejects component formats unsupported by the configured renderer", async () => {
    const root = createRoot();
    write(root, "src/ui/missing.vue");
    const config = await resolveConfig(
      { root, notFound: { component: "./src/ui/missing.vue" } },
      "production",
    );

    expect(() => resolveFarmNotFoundComponentPath(config, [path.join(root, "src/app")])).toThrow(
      "notFound.component must use one of the configured renderer extensions",
    );
  });

  it("keeps project conventions ahead of extended app directories", async () => {
    const root = createRoot();
    const baseApp = path.join(root, "base/app");
    const projectApp = path.join(root, "src/app");
    write(root, "base/app/not-found.tsx");
    const projectNotFound = write(root, "src/app/not-found.tsx");
    const config = await resolveConfig({ root }, "production");

    expect(resolveFarmNotFoundComponentPath(config, [baseApp, projectApp])).toBe(projectNotFound);
  });
});
