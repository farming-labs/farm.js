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
    await fs.promises.mkdir(path.join(appDir, "users", "[id]"), {
      recursive: true,
    });
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
    expect(content).toContain("export type RoutePattern =");
    expect(content).toContain('"/"');
    expect(content).toContain('"/about"');
    expect(content).toContain('"/content"');
    expect(content).toContain("LinkDefaultRoute");
    expect(content).toContain('declare module "@farm.js/core/client"');
    expect(content).toContain('declare module "@farm.js/core"');
    expect(content).toContain('declare module "@farm.js/core/dist/client.js"');
    expect(content).toContain('_: import("./farm-routes").RoutePath');
    expect(content).toContain('pattern: import("./farm-routes").RoutePattern');
  });

  it("types route-slot targets without exposing slot directory syntax", async () => {
    const feedDir = path.join(tmpDir, "src", "app", "feed");
    const photoDir = path.join(feedDir, "photo", "[id]");
    const modalDir = path.join(feedDir, "@modal", "(.)photo", "[id]");
    const activityDir = path.join(feedDir, "@activity");
    await fs.promises.mkdir(photoDir, { recursive: true });
    await fs.promises.mkdir(modalDir, { recursive: true });
    await fs.promises.mkdir(activityDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(feedDir, "page.tsx"),
      "export default function Feed() { return null; }",
    );
    await fs.promises.writeFile(
      path.join(photoDir, "page.tsx"),
      "export default function Photo() { return null; }",
    );
    await fs.promises.writeFile(
      path.join(modalDir, "page.tsx"),
      "export default function Modal() { return null; }",
    );
    await fs.promises.writeFile(
      path.join(activityDir, "page.tsx"),
      "export default function Activity() { return null; }",
    );

    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    const content = fs.readFileSync(outPath, "utf8");

    expect(content).toContain('"/feed"');
    expect(content).toContain("`/feed/photo/${string}`");
    expect(content).not.toContain("@modal");
    expect(content).not.toContain("@activity");
    expect(content).not.toContain("(.)photo");
  });

  it("when suppressLintOnLink is true, does not augment LinkDefaultRoute and route types are string", async () => {
    const outPath = await generateRouteTypes({
      root: tmpDir,
      srcDir: "src",
      suppressLintOnLink: true,
    });
    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain("export type RoutePath = string");
    expect(content).toContain("export type RoutePattern = string");
    expect(content).not.toContain("declare module");
    expect(content).not.toContain("LinkDefaultRoute");
  });

  it("regenerates when a new page is added", async () => {
    await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    let content = fs.readFileSync(path.join(tmpDir, "src", "farm-routes.d.ts"), "utf8");
    expect(content).not.toContain("/blog");

    await fs.promises.mkdir(path.join(tmpDir, "src", "app", "blog"), {
      recursive: true,
    });
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
    expect(content).toContain('"/docs/[...docs]"');
    expect(content).toContain("`/docs/${string}`");
  });

  it("includes the base and nested URLs for an optional catch-all page", async () => {
    const routeDir = path.join(tmpDir, "src", "app", "docs", "[[...slug]]");
    await fs.promises.mkdir(routeDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(routeDir, "page.tsx"),
      "export default function Docs() { return null; }",
    );

    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    const content = fs.readFileSync(outPath, "utf8");
    const routePath = content.match(/export type RoutePath = ([^;]+);/)?.[1];

    expect(routePath).toContain('"/docs"');
    expect(routePath).toContain("`/docs/${string}`");
    expect(content).toContain('export type RoutePattern = "/" | "/about"');
    expect(content).toContain('"/docs/[[...slug]]"');
  });

  it("includes literal page paths from programmatic route files", async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, "src", "farm.routes.ts"),
      `
import { defineRoutes } from "@farm.js/core/routes";
import { MarketingPage } from "./marketing-page";

export default defineRoutes(({ page }) => [
  page("/marketing/[slug]", { component: MarketingPage }),
]);
`,
    );

    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    const content = fs.readFileSync(outPath, "utf8");

    expect(content).toContain("`/marketing/${string}`");
    expect(content).toContain('"/marketing/[slug]"');
  });

  it("includes literal createRoute paths from normal feature files", async () => {
    const productRouteFile = path.join(tmpDir, "src", "features", "products", "page.tsx");
    await fs.promises.mkdir(path.dirname(productRouteFile), {
      recursive: true,
    });
    await fs.promises.writeFile(
      productRouteFile,
      `
import { createRoute } from "@farm.js/core/routes";

function ProductPage() {
  return null;
}

export const ProductRoute = createRoute("/products/[id]", {
  component: ProductPage,
});
`,
    );

    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    const content = fs.readFileSync(outPath, "utf8");

    expect(content).toContain("`/products/${string}`");
    expect(content).toContain('"/products/[id]"');
  });

  it("writes a valid empty route union when no pages exist", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "farm-empty-route-types-"));
    try {
      await fs.promises.mkdir(path.join(root, "src", "app"), {
        recursive: true,
      });

      const outPath = await generateRouteTypes({ root, srcDir: "src" });
      const content = fs.readFileSync(outPath, "utf8");

      expect(content).toContain("export type RoutePath = never;");
      expect(content).toContain("export type RoutePattern = never;");
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});
