import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createFarmPublicFileIndex,
  devServableFileExists,
  farmAppOwnsDocsEnginePath,
  isMalformedFarmRequestPathname,
  resolveFarmPublicFilePath,
  shouldBypassFarmRouterForDottedPath,
} from "../dev-static";

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

  it("keeps a generated /llms.txt on the Farm renderer", () => {
    // agent.llmsTxt serves /llms.txt without an llms.ts file, so no route matches it;
    // treating it as a static file 404'd it in dev while production served it.
    const routeManager = createRouteManager({});
    expect(
      shouldBypassFarmRouterForDottedPath(
        "/llms.txt",
        routeManager,
        [publicDir, root],
        ["/llms.txt"],
      ),
    ).toBe(false);
    expect(shouldBypassFarmRouterForDottedPath("/llms.txt", routeManager, [publicDir, root])).toBe(
      true,
    );
  });

  it("lets a real file shadow a generated path", () => {
    fs.writeFileSync(path.join(publicDir, "llms.txt"), "# Static");
    try {
      expect(
        shouldBypassFarmRouterForDottedPath(
          "/llms.txt",
          createRouteManager({}),
          [publicDir, root],
          ["/llms.txt"],
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(path.join(publicDir, "llms.txt"));
    }
  });

  it("treats a public llms file as the app's own, ahead of the docs engine", () => {
    const owns = (pathname: string, generatedPaths: string[] = [], metadata: string[] = []) =>
      farmAppOwnsDocsEnginePath(pathname, {
        generatedPaths,
        routeManager: createRouteManager({ metadata }),
        publicDir,
      });

    expect(owns("/llms.txt")).toBe(false);
    expect(owns("/llms.txt", ["/llms.txt"])).toBe(true);
    // As in production, a trailing slash names the same file; the docs engine reads it so.
    expect(owns("/llms.txt/", ["/llms.txt"])).toBe(true);
    expect(owns("/llms-full.txt", [], ["/llms-full.txt"])).toBe(true);
    fs.writeFileSync(path.join(publicDir, "llms-full.txt"), "# Static");
    try {
      // agent.llmsTxt off and no route file: the public file still owns the path.
      expect(owns("/llms-full.txt")).toBe(true);
    } finally {
      fs.rmSync(path.join(publicDir, "llms-full.txt"));
    }
    fs.writeFileSync(path.join(root, "llms.txt"), "# Draft");
    try {
      // Production does not emit files outside the public dir, so neither does this.
      expect(owns("/llms.txt")).toBe(false);
    } finally {
      fs.rmSync(path.join(root, "llms.txt"));
    }
  });

  it("treats a root sitemap.ts or robots.ts as the app's own, ahead of the docs engine", () => {
    const owns = (pathname: string, metadata: string[] = []) =>
      farmAppOwnsDocsEnginePath(pathname, {
        generatedPaths: [],
        routeManager: createRouteManager({ metadata }),
        publicDir,
      });

    // No sitemap.ts or robots.ts: the docs engine keeps both.
    expect(owns("/sitemap.xml")).toBe(false);
    expect(owns("/robots.txt")).toBe(false);
    expect(owns("/sitemap.xml", ["/sitemap.xml"])).toBe(true);
    expect(owns("/robots.txt", ["/robots.txt"])).toBe(true);
    fs.writeFileSync(path.join(publicDir, "robots.txt"), "User-agent: *\n");
    try {
      expect(owns("/robots.txt")).toBe(true);
    } finally {
      fs.rmSync(path.join(publicDir, "robots.txt"));
    }
    // The docs engine's other sitemap paths and other metadata files stay out of scope.
    expect(owns("/sitemap.md", ["/sitemap.md"])).toBe(false);
    expect(owns("/manifest.webmanifest", ["/manifest.webmanifest"])).toBe(false);
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

  it("routes a file's path for POST, as production only serves files to GET and HEAD", () => {
    fs.writeFileSync(path.join(publicDir, "hello.txt"), "hi");
    try {
      const bypass = (pathname: string, method: string) =>
        shouldBypassFarmRouterForDottedPath(
          pathname,
          createRouteManager({}),
          [publicDir, root],
          [],
          method,
        );
      expect(bypass("/hello.txt", "GET")).toBe(true);
      expect(bypass("/hello.txt", "HEAD")).toBe(true);
      expect(bypass("/hello.txt", "POST")).toBe(false);
      // A dotted path with no file still goes to Vite first (its proxy, for one).
      expect(bypass("/legacy/submit.php", "POST")).toBe(true);
    } finally {
      fs.rmSync(path.join(publicDir, "hello.txt"));
    }
  });
});

describe("isMalformedFarmRequestPathname", () => {
  it("matches the paths h3 rejects", () => {
    for (const pathname of ["/%ZZ", "/api/items/%E0%A4", "/a%", "/a%2"]) {
      expect(isMalformedFarmRequestPathname(pathname), pathname).toBe(true);
    }
    for (const pathname of ["/", "/about", "/caf%C3%A9", "/a%2Fb", "/%25ZZ"]) {
      expect(isMalformedFarmRequestPathname(pathname), pathname).toBe(false);
    }
  });
});

describe("resolveFarmPublicFilePath", () => {
  const files = new Set(["/hello.txt", "/landing.html", "/sub/index.html", "/my file.txt"]);

  it("resolves files and directory indexes as Nitro's static handler does", () => {
    expect(resolveFarmPublicFilePath("/hello.txt", files)).toBe("/hello.txt");
    expect(resolveFarmPublicFilePath("/hello.txt/", files)).toBe("/hello.txt");
    expect(resolveFarmPublicFilePath("/landing.html", files)).toBe("/landing.html");
    expect(resolveFarmPublicFilePath("/sub", files)).toBe("/sub/index.html");
    expect(resolveFarmPublicFilePath("/sub/", files)).toBe("/sub/index.html");
    expect(resolveFarmPublicFilePath("/sub/index.html", files)).toBe("/sub/index.html");
    expect(resolveFarmPublicFilePath("/my%20file.txt", files)).toBe("/my file.txt");
  });

  it("serves nothing else", () => {
    for (const pathname of ["/", "/nope.txt", "/hello.txt//", "//sub/", "/sub%2Findex.html"]) {
      expect(resolveFarmPublicFilePath(pathname, files), pathname).toBeNull();
    }
    expect(resolveFarmPublicFilePath("/", new Set(["/index.html"]))).toBe("/index.html");
  });
});

describe("createFarmPublicFileIndex", () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-dev-public-index-"));
    fs.mkdirSync(path.join(root, "public", "sub"), { recursive: true });
    fs.writeFileSync(path.join(root, "public", "hello.txt"), "hi");
    fs.writeFileSync(path.join(root, "public", "sub", "index.html"), "<p>sub</p>");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists the public dir once and again after a change inside it", () => {
    const publicDir = path.join(root, "public");
    const index = createFarmPublicFileIndex(() => publicDir);
    const first = index.get();
    expect([...first].sort()).toEqual(["/hello.txt", "/sub/index.html"]);
    expect(index.get()).toBe(first);

    const added = path.join(publicDir, "added.txt");
    fs.writeFileSync(added, "new");
    // A change elsewhere keeps the listing.
    index.invalidate(path.join(root, "src", "page.tsx"));
    expect(index.get()).toBe(first);
    index.invalidate(added);
    expect([...index.get()].sort()).toEqual(["/added.txt", "/hello.txt", "/sub/index.html"]);

    expect(createFarmPublicFileIndex(() => false).get().size).toBe(0);
    expect(createFarmPublicFileIndex(() => path.join(root, "missing")).get().size).toBe(0);
  });
});
