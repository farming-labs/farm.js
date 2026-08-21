import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { devServableFileExists, shouldBypassFarmRouterForDottedPath } from "../dev-static";

describe("devServableFileExists", () => {
  let root: string;
  let publicDir: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-dev-static-"));
    publicDir = path.join(root, "public");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(path.join(root, "src", "main.tsx"), "export {};\n");
    fs.writeFileSync(path.join(publicDir, "favicon.ico"), "icon");
    fs.writeFileSync(path.join(publicDir, "hello world.txt"), "hi");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns true for a real file under the project root", () => {
    expect(devServableFileExists("/src/main.tsx", [publicDir, root])).toBe(true);
  });

  it("returns true for a real file under the public dir", () => {
    expect(devServableFileExists("/favicon.ico", [publicDir, root])).toBe(true);
  });

  it("decodes URI-encoded pathnames", () => {
    expect(devServableFileExists("/hello%20world.txt", [publicDir, root])).toBe(true);
  });

  it("returns false for a dotted route path with no backing file", () => {
    expect(devServableFileExists("/kinfish/farm.js", [publicDir, root])).toBe(false);
  });

  it("returns false for directories", () => {
    expect(devServableFileExists("/src", [publicDir, root])).toBe(false);
  });

  it("returns false for path traversal attempts", () => {
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(outside, "secret");
    expect(devServableFileExists("/../outside.txt", [publicDir])).toBe(false);
    expect(devServableFileExists("/..%2Foutside.txt", [publicDir])).toBe(false);
  });

  it("returns false for malformed URI encodings", () => {
    expect(devServableFileExists("/%zz.js", [publicDir, root])).toBe(false);
  });

  it("ignores non-string base dirs", () => {
    expect(devServableFileExists("/favicon.ico", [false, undefined, publicDir])).toBe(true);
    expect(devServableFileExists("/favicon.ico", [false, undefined])).toBe(false);
  });
});

describe("shouldBypassFarmRouterForDottedPath", () => {
  let root: string;
  let publicDir: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-dev-dotted-"));
    publicDir = path.join(root, "public");
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(path.join(publicDir, "favicon.ico"), "icon");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function createRouteManager(matches: { page?: string[]; metadata?: string[]; image?: string[] }) {
    return {
      matchRoute: (pathname: string) => (matches.page?.includes(pathname) ? { route: {} } : null),
      matchMetadataRoute: (pathname: string) => (matches.metadata?.includes(pathname) ? {} : null),
      matchMetadataImage: (pathname: string) => (matches.image?.includes(pathname) ? {} : null),
    };
  }

  it("keeps metadata routes with dotted URLs on the Farm renderer", () => {
    // /manifest.webmanifest is served by manifest.ts auto-discovery, not a
    // page route; bypassing the renderer 404s it in dev (#407).
    const routeManager = createRouteManager({
      metadata: ["/manifest.webmanifest", "/sitemap.xml", "/robots.txt"],
    });
    for (const pathname of ["/manifest.webmanifest", "/sitemap.xml", "/robots.txt"]) {
      expect(shouldBypassFarmRouterForDottedPath(pathname, routeManager, [publicDir, root])).toBe(
        false,
      );
    }
  });

  it("keeps generated metadata images on the Farm renderer", () => {
    const routeManager = createRouteManager({ image: ["/opengraph-image.png"] });
    expect(
      shouldBypassFarmRouterForDottedPath("/opengraph-image.png", routeManager, [publicDir, root]),
    ).toBe(false);
  });

  it("keeps dotted page routes on the Farm renderer", () => {
    const routeManager = createRouteManager({ page: ["/kinfish/farm.js"] });
    expect(
      shouldBypassFarmRouterForDottedPath("/kinfish/farm.js", routeManager, [publicDir, root]),
    ).toBe(false);
  });

  it("bypasses the router for unmatched dotted paths", () => {
    const routeManager = createRouteManager({});
    expect(
      shouldBypassFarmRouterForDottedPath("/missing.webmanifest", routeManager, [publicDir, root]),
    ).toBe(true);
  });

  it("lets a real file shadow a matching metadata route", () => {
    const routeManager = createRouteManager({ metadata: ["/favicon.ico"] });
    expect(
      shouldBypassFarmRouterForDottedPath("/favicon.ico", routeManager, [publicDir, root]),
    ).toBe(true);
  });

  it("never bypasses undotted or html paths", () => {
    const routeManager = createRouteManager({});
    expect(shouldBypassFarmRouterForDottedPath("/about", routeManager, [publicDir, root])).toBe(
      false,
    );
    expect(shouldBypassFarmRouterForDottedPath("/page.html", routeManager, [publicDir, root])).toBe(
      false,
    );
  });
});
