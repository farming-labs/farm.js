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
    await fs.promises.mkdir(path.join(appDir, "content"), { recursive: true });
    await fs.promises.mkdir(path.join(appDir, "users", "[id]"), { recursive: true });
    await fs.promises.writeFile(
      path.join(appDir, "page.tsx"),
      "export default function Home() { return null; }",
    );
    await fs.promises.writeFile(
      path.join(appDir, "about", "page.tsx"),
      "export default function About() { return null; }",
    );
    await fs.promises.writeFile(path.join(appDir, "content", "page.mdx"), "# Content");
    await fs.promises.writeFile(
      path.join(appDir, "users", "[id]", "page.tsx"),
      "export default function User() { return null; }",
    );
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
    expect(content).toContain('"/content"');
    expect(content).toContain("LinkDefaultRoute");
    expect(content).toContain('declare module "@farmjs/core/client"');
    expect(content).toContain('declare module "@farmjs/core"');
    expect(content).toContain('declare module "@farmjs/core/dist/client.js"');
    expect(content).toContain('_: import("./farm-routes").RoutePath');
  });

  it("when suppressLintOnLink is true, does not augment LinkDefaultRoute and RoutePath is string", async () => {
    const outPath = await generateRouteTypes({
      root: tmpDir,
      srcDir: "src",
      suppressLintOnLink: true,
    });
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
    await fs.promises.writeFile(
      path.join(tmpDir, "src", "app", "blog", "page.tsx"),
      "export default function Blog() { return null; }",
    );
    await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    content = fs.readFileSync(path.join(tmpDir, "src", "farm-routes.d.ts"), "utf8");
    expect(content).toContain('"/blog"');
  });

  it("includes configured extra routes in the generated union", async () => {
    const outPath = await generateRouteTypes({
      root: tmpDir,
      srcDir: "src",
      extraRoutes: ["/docs/reference", "/docs", "/docs/[...docs]"],
    });

    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain('"/docs/reference"');
    expect(content).toContain('"/docs"');
    expect(content).toContain("`/docs/${string}`");
  });

  it("includes literal page paths from programmatic route files", async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, "src", "farm.routes.ts"),
      `
import { defineRoutes } from "@farmjs/core/routes";
import { MarketingPage } from "./marketing-page";

export default defineRoutes(({ page }) => [
  page("/marketing/[slug]", { component: MarketingPage }),
]);
`,
    );

    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    const content = fs.readFileSync(outPath, "utf8");

    expect(content).toContain("`/marketing/${string}`");
  });

  it("writes a valid empty route union when no pages exist", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "farm-empty-route-types-"));
    try {
      await fs.promises.mkdir(path.join(root, "src", "app"), { recursive: true });

      const outPath = await generateRouteTypes({ root, srcDir: "src" });
      const content = fs.readFileSync(outPath, "utf8");

      expect(content).toContain("export type RoutePath = never;");
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});
