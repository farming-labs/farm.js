import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { defineRoutes } from "../routes";
import { RouteManager } from "../routing/route-manager";
import type { FarmConfig } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createConfig(root: string): Required<FarmConfig> {
  return {
    root,
    srcDir: "src",
    outDir: "dist",
    basePath: "/",
    suppressLintOnLink: false,
    experimental: {
      serverComponents: true,
      serverActions: true,
    },
    mdx: {
      markdownRoutes: true,
      className: "farm-markdown",
    },
    vite: {},
  } as Required<FarmConfig>;
}

describe("programmatic routes", () => {
  it("discovers page, layout, redirect, staticPaths, and render metadata", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-programmatic-routes-"));
    tempDirs.push(root);

    const routesFile = path.join(root, "src", "farm.routes.js");
    fs.mkdirSync(path.dirname(routesFile), { recursive: true });
    fs.writeFileSync(routesFile, "export {};\n");

    function BlogPage() {
      return null;
    }

    function RootLayout() {
      return null;
    }

    const manifest = defineRoutes(({ page, layout, redirect }) => [
      layout("/", {
        component: RootLayout,
        metadata: { title: "Programmatic Layout" },
      }),
      page("/blog/[slug]", {
        component: BlogPage,
        render: "static",
        revalidate: 60,
        staticPaths: async () => ["hello-world", "farm-router"],
        metadata: { title: "Programmatic Blog" },
      }),
      redirect("/old-blog/[slug]", "/blog/[slug]", { permanent: true }),
    ]);

    const manager = new RouteManager(createConfig(root), {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routesFile);
        return { default: manifest };
      },
    } as any);

    await manager.discoverRoutes();

    const match = manager.matchRoute("/blog/hello-world");
    expect(match.route?.pattern).toBe("/blog/[slug]");
    expect(match.params).toEqual({ slug: "hello-world" });

    const routeModule = await manager.loadRouteModule(match.route!.modulePath);
    expect(routeModule.default).toBe(BlogPage);
    expect(routeModule.ssg).toBe(true);
    expect(routeModule.dynamic).toBe("force-static");
    expect(routeModule.revalidate).toBe(60);
    expect(routeModule.metadata).toEqual({ title: "Programmatic Blog" });
    await expect(routeModule.getStaticPaths?.()).resolves.toEqual([
      { slug: "hello-world" },
      { slug: "farm-router" },
    ]);

    const layoutEntry = manager.getLayouts().get("/");
    expect(layoutEntry?.source).toBe("programmatic");
    const layoutModule = await manager.loadLayoutModule(layoutEntry!.modulePath);
    expect(layoutModule.default).toBe(RootLayout);
    expect(layoutModule.metadata).toEqual({ title: "Programmatic Layout" });

    expect(manager.matchRedirect("/old-blog/hello-world")).toMatchObject({
      destination: "/blog/hello-world",
      statusCode: 308,
      params: { slug: "hello-world" },
    });

    const ssgPages = await manager.collectSSGPages();
    expect(ssgPages.ssg.map((page) => page.urlPath).sort()).toEqual([
      "/blog/farm-router",
      "/blog/hello-world",
    ]);
  });

  it("rejects duplicate page routes across file and programmatic definitions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-programmatic-duplicates-"));
    tempDirs.push(root);

    const appPage = path.join(root, "src", "app", "about", "page.tsx");
    const routesFile = path.join(root, "src", "farm.routes.js");
    fs.mkdirSync(path.dirname(appPage), { recursive: true });
    fs.mkdirSync(path.dirname(routesFile), { recursive: true });
    fs.writeFileSync(appPage, "export default function About() { return null; }\n");
    fs.writeFileSync(routesFile, "export {};\n");

    const manager = new RouteManager(createConfig(root), {
      ssrLoadModule: async () => ({
        default: defineRoutes(({ page }) => [
          page("/about", {
            component: function AboutOverride() {
              return null;
            },
          }),
        ]),
      }),
    } as any);

    await expect(manager.discoverRoutes()).rejects.toThrow('Duplicate page route "/about"');
  });
});
