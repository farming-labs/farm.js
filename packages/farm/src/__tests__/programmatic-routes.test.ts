import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFarmDataCache, invalidate, revalidatePath } from "../cache";
import { createRoute, defineRoutes } from "../routes";
import { RouteManager } from "../routing/route-manager";
import type { FarmConfig } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  getFarmDataCache().clear();
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

  it("accepts a typed createRoute export from a singular farm.route entry", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-create-route-"));
    tempDirs.push(root);

    const routesFile = path.join(root, "src", "farm.route.tsx");
    fs.mkdirSync(path.dirname(routesFile), { recursive: true });
    fs.writeFileSync(
      routesFile,
      'export { ProductRoute as Route } from "./features/products/page";\n',
    );

    function ProductPage() {
      return null;
    }

    const paramsSchema = {
      parse: vi.fn((value: unknown) => ({ id: `product-${(value as any).id}` })),
    };
    const searchSchema = {
      parse: vi.fn((value: unknown) => ({ tab: (value as any).tab || "info" })),
    };
    const afterData: unknown[] = [];
    const before = vi.fn(async ({ params }: any) => ({
      token: `before-${params.id}`,
    }));
    const main = vi.fn(async ({ params, search, before }: any) => ({
      product: {
        id: params.id,
        tab: search.tab,
        token: before.token,
      },
    }));
    const after = vi.fn(async ({ data }: any) => {
      afterData.push(data);
    });
    const ProductRoute = createRoute("/products/[id]", {
      params: paramsSchema,
      search: searchSchema,
      data: {
        before,
        main,
        after,
      },
      component: ProductPage as any,
      render: "dynamic",
    });

    const manager = new RouteManager(createConfig(root), {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routesFile);
        return { Route: ProductRoute };
      },
    } as any);

    await manager.discoverRoutes();

    const match = manager.matchRoute("/products/123");
    expect(match.route?.pattern).toBe("/products/[id]");
    expect(match.params).toEqual({ id: "123" });

    const routeModule = await manager.loadRouteModule(match.route!.modulePath);
    expect((routeModule as any).__farmRouteSchemas.params).toBe(paramsSchema);
    expect((routeModule as any).__farmRouteSchemas.search).toBe(searchSchema);
    expect((routeModule as any).__farmRouteData).toBe(ProductRoute.data);
    expect((routeModule as any).__farmRouteParsesProps).toBe(true);
    expect(typeof (routeModule as any).__farmResolveRouteProps).toBe("function");
    expect(routeModule.dynamic).toBe("force-dynamic");

    const Page = routeModule.default as any;
    const element = (await Page({
      params: { id: "123" },
      searchParams: Promise.resolve({}),
      path: "/products/123",
    })) as any;

    expect(element.type).toBe(ProductPage);
    expect(element.props.params).toEqual({ id: "product-123" });
    expect(element.props.search).toEqual({ tab: "info" });
    expect(element.props.data).toEqual({
      product: {
        id: "product-123",
        tab: "info",
        token: "before-product-123",
      },
    });
    await expect(element.props.searchParams).resolves.toEqual({ tab: "info" });
    expect(before).toHaveBeenCalledTimes(1);
    expect(main).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(afterData).toEqual([element.props.data]);

    before.mockClear();
    main.mockClear();
    after.mockClear();
    afterData.length = 0;

    const resolvedProps = await (routeModule as any).__farmResolveRouteProps({
      params: { id: "123" },
      searchParams: Promise.resolve({ tab: "reviews" }),
      path: "/products/123",
    });
    expect(resolvedProps.data).toEqual({
      product: {
        id: "product-123",
        tab: "reviews",
        token: "before-product-123",
      },
    });
    expect(resolvedProps.__farmRoutePropsResolved).toBe(true);
    expect(before).toHaveBeenCalledTimes(1);
    expect(main).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);

    before.mockClear();
    main.mockClear();
    after.mockClear();
    const resolvedElement = (await Page(resolvedProps)) as any;
    expect(resolvedElement.props.data).toBe(resolvedProps.data);
    expect(before).not.toHaveBeenCalled();
    expect(main).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("caches programmatic route data by key and supports invalidation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-route-data-cache-"));
    tempDirs.push(root);

    const routesFile = path.join(root, "src", "farm.route.tsx");
    fs.mkdirSync(path.dirname(routesFile), { recursive: true });
    fs.writeFileSync(routesFile, "export {};\n");

    function ProductPage() {
      return null;
    }

    let calls = 0;
    const before = vi.fn(async ({ params }: any) => ({ token: `token-${params.id}` }));
    const main = vi.fn(async ({ params, before }: any) => ({
      id: params.id,
      token: before.token,
      calls: ++calls,
    }));
    const after = vi.fn();

    const ProductRoute = createRoute("/products/[id]", {
      data: {
        key: ({ params }) => ["product", params.id],
        staleTime: "30s",
        tags: ({ params }) => [`product:${params.id}`],
        before,
        main,
        after,
      },
      component: ProductPage as any,
    });

    const manager = new RouteManager(createConfig(root), {
      ssrLoadModule: async () => ({ Route: ProductRoute }),
    } as any);

    await manager.discoverRoutes();
    const match = manager.matchRoute("/products/123");
    const routeModule = await manager.loadRouteModule(match.route!.modulePath);
    const resolveProps = (searchParams = {}) =>
      (routeModule as any).__farmResolveRouteProps({
        params: { id: "123" },
        searchParams: Promise.resolve(searchParams),
        path: "/products/123",
      });

    await expect(resolveProps()).resolves.toMatchObject({
      data: { id: "123", token: "token-123", calls: 1 },
    });
    await expect(resolveProps()).resolves.toMatchObject({
      data: { id: "123", token: "token-123", calls: 1 },
    });

    expect(before).toHaveBeenCalledTimes(2);
    expect(main).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(2);

    invalidate(["product", "123"]);

    await expect(resolveProps()).resolves.toMatchObject({
      data: { id: "123", token: "token-123", calls: 2 },
    });
    expect(main).toHaveBeenCalledTimes(2);

    revalidatePath("/products/123");

    await expect(resolveProps()).resolves.toMatchObject({
      data: { id: "123", token: "token-123", calls: 3 },
    });
    expect(main).toHaveBeenCalledTimes(3);
  });
});
