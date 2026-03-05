import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generateRouteTypes } from "../routing/generate-route-types";

describe("generateRouteTypes", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "farm-route-types-"));
    const appDir = path.join(tmpDir, "src", "app");
    await fs.promises.mkdir(path.join(appDir, "about"), { recursive: true });
    await fs.promises.mkdir(path.join(appDir, "users", "[id]"), { recursive: true });
    await fs.promises.writeFile(path.join(appDir, "page.tsx"), "export default function Home() { return null; }");
    await fs.promises.writeFile(path.join(appDir, "about", "page.tsx"), "export default function About() { return null; }");
    await fs.promises.writeFile(path.join(appDir, "users", "[id]", "page.tsx"), "export default function User() { return null; }");
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes farm-routes.d.ts with RoutePath and module augmentation", async () => {
    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    expect(outPath).toBe(path.join(tmpDir, "src", "farm-routes.d.ts"));

    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain("export type RoutePath =");
    expect(content).toContain('"/"');
    expect(content).toContain('"/about"');
    expect(content).toContain("LinkDefaultRoute");
    expect(content).toContain('declare module "@farmjs/core/client"');
    expect(content).toContain("_: RoutePath");
  });

  it("when suppressLintOnLink is true, does not augment LinkDefaultRoute and RoutePath is string", async () => {
    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src", suppressLintOnLink: true });
    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain("export type RoutePath = string");
    expect(content).not.toContain("declare module");
    expect(content).not.toContain("LinkDefaultRoute");
  });

  it("regenerates when a new page is added", async () => {
    await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    let content = fs.readFileSync(path.join(tmpDir, "src", "farm-routes.d.ts"), "utf8");
    expect(content).not.toContain("/blog");

    await fs.promises.mkdir(path.join(tmpDir, "src", "app", "blog"), { recursive: true });
    await fs.promises.writeFile(path.join(tmpDir, "src", "app", "blog", "page.tsx"), "export default function Blog() { return null; }");
    await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    content = fs.readFileSync(path.join(tmpDir, "src", "farm-routes.d.ts"), "utf8");
    expect(content).toContain('"/blog"');
  });
});
