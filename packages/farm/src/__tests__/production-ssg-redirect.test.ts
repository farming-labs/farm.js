// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { startProductionServer, type ProductionServer } from "./production-server";

/**
 * A static page that calls `redirect()` has no HTML to save. It used to be prerendered as its
 * empty redirect body and served as a blank 200 with no Location.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let root: string | undefined;
let server: ProductionServer | undefined;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(packageRoot, ".tmp-ssg-redirect-"));
  const write = async (relativePath: string, source: string) => {
    await fs.mkdir(path.dirname(path.join(root!, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root!, relativePath), source);
  };
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await write("package.json", '{"type":"module","private":true}');
  await write(
    "src/app/layout.tsx",
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  );
  await write(
    "src/app/target/page.tsx",
    `export const dynamic = "force-static";
export default function Target() { return <main>target-page</main>; }`,
  );
  await write(
    "src/app/moved/page.tsx",
    `import { redirect } from "@farm.js/core";
export const dynamic = "force-static";
export default function Moved() { redirect("/target"); }`,
  );
  await write(
    "src/app/legacy/[slug]/page.tsx",
    `import { permanentRedirect } from "@farm.js/core";
export const dynamic = "force-static";
export function generateStaticParams() { return [{ slug: "old" }]; }
export default function Legacy() { permanentRedirect("/target"); }`,
  );
  const config = await resolveConfig(
    { root, srcDir: "src", telemetry: false, images: { provider: "none" } },
    "production",
  );
  await build(config, { root, preset: "node-server" });

  server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
}, 180_000);

afterAll(async () => {
  // Windows refuses to remove the output while the server still holds it as its cwd.
  await server?.stop();
  if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("a static page that redirects", () => {
  it("is not written as a file, while a page that renders still is", async () => {
    const publicDir = path.join(root!, ".farm", ".output", "public");
    const files = (await fs.readdir(publicDir, { recursive: true })).map((file) =>
      String(file).split(path.sep).join("/"),
    );
    expect(files).toContain("target/index.html");
    expect(files.filter((file) => /^(moved|legacy)/.test(file))).toEqual([]);
  });

  it.each([
    ["redirect()", "/moved", 307],
    ["permanentRedirect() for a static param", "/legacy/old", 308],
  ])("answers %s with its redirect", async (_label, pathname, status) => {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(`${server!.origin}${pathname}`, { method, redirect: "manual" });
      expect({ method, status: response.status }).toEqual({ method, status });
      expect(response.headers.get("location")).toBe("/target");
    }
  });

  it("still serves the page that renders", async () => {
    const response = await fetch(`${server!.origin}/target`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("target-page");
  });
});
