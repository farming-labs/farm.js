import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { getFarmDataCache, invalidate, revalidatePath } from "../cache";
import { defer, isDeferred, type Deferred } from "../deferred";
import { notFound, redirect } from "../navigation";
import {
  FARM_ROUTE_CONTEXT_SYMBOL,
  resolveFarmRouteContext,
  withFarmRouteContext,
} from "../route-context";
import {
  createRoute,
  createRouteModuleFromProgrammaticPage,
  defineRoutes,
  type InferProgrammaticRouteData,
  type ProgrammaticPageRoute,
} from "../routes";
import { RouteManager } from "../routing/route-manager";
import { createServerFn } from "../server-fn";
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
  it("owns typed named actions and resolves a default action", async () => {
    const update = createServerFn({
      input: z.object({ id: z.string(), name: z.string() }),
      handler: async ({ input }) => ({ ...input, saved: true as const }),
    });
    const publish = createServerFn({
      input: z.object({ id: z.string() }),
      handler: async ({ input }) => ({ id: input.id, published: true as const }),
    });

    const route = createRoute("/products/[id]", {
      actions: { update, publish },
      defaultAction: "update",
      component: () => null,
    });

    expect(route.actions).toEqual({ update, publish });
    expect(route.defaultAction).toBe("update");
    expect(route.action).toBe(update);
    await expect(route.action({ id: "p1", name: "Keyboard" })).resolves.toEqual({
      id: "p1",
      name: "Keyboard",
      saved: true,
    });
    expectTypeOf(route.action).toEqualTypeOf(update);
    expectTypeOf(route.actions.publish).toEqualTypeOf(publish);
  });

  it("uses the first named action by default and rejects an unknown default", () => {
    const update = createServerFn({ handler: async () => ({ saved: true as const }) });
    const route = createRoute("/products", {
      actions: { update },
      component: () => null,
    });

    expect(route.defaultAction).toBe("update");
    expect(route.action).toBe(update);

    expect(() =>
      createRoute("/invalid", {
        actions: { update },
        defaultAction: "remove",
        component: () => null,
      } as any),
    ).toThrow('defaultAction "remove" does not match a declared action');
  });

  it("infers params, search, before data, main data, and component props", () => {
    const paramsSchema = {
      parse: (_value: unknown) => ({ id: "product-1" }),
    };
    const searchSchema = {
      parse: (_value: unknown) => ({ tab: "info" as "info" | "reviews" }),
    };

    const route = createRoute("/typed-products/[id]", {
      params: paramsSchema,
      search: searchSchema,
      data: {
        before({ params, search }) {
          expectTypeOf(params).toEqualTypeOf<{ id: string }>();
          expectTypeOf(search).toEqualTypeOf<{ tab: "info" | "reviews" }>();
          return { token: `${params.id}:${search.tab}` };
        },
        async main({ params, before }) {
          expectTypeOf(before).toEqualTypeOf<{ token: string }>();
          return { label: `${params.id}:${before.token}` };
        },
        after({ data }) {
          expectTypeOf(data).toEqualTypeOf<{ label: string }>();
        },
      },
      component(props) {
        expectTypeOf(props.params).toEqualTypeOf<{ id: string }>();
        expectTypeOf(props.search).toEqualTypeOf<{ tab: "info" | "reviews" }>();
        expectTypeOf(props.data).toEqualTypeOf<{ label: string }>();
        return null;
      },
    });

    expectTypeOf<InferProgrammaticRouteData<NonNullable<typeof route.data>>>().toEqualTypeOf<{
      label: string;
    }>();
  });

  it("passes deferred main data to after and the component without awaiting it", async () => {
    const reviews = createControlledPromise<string[]>();
    const after = vi.fn();
    const route = createRoute("/streamed-products/[id]", {
      data: {
        main({ params }) {
          return {
            product: { id: params.id },
            reviews: defer(reviews.promise),
          };
        },
        after({ data }) {
          expectTypeOf(data.reviews).toEqualTypeOf<Deferred<string[]>>();
          after(data);
        },
      },
      component(props) {
        expectTypeOf(props.data.reviews).toEqualTypeOf<Deferred<string[]>>();
        return null;
      },
    });
    const routeModule = createRouteModuleFromProgrammaticPageForTest(route);

    const resolved = await (routeModule as any).__farmResolveRouteProps({
      params: { id: "p1" },
      searchParams: Promise.resolve({}),
      path: "/streamed-products/p1",
    });

    expect(resolved.data.product).toEqual({ id: "p1" });
    expect(isDeferred(resolved.data.reviews)).toBe(true);
    expect(after).toHaveBeenCalledWith(resolved.data);

    reviews.resolve(["Excellent"]);
    await expect(resolved.data.reviews).resolves.toEqual(["Excellent"]);
  });

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
      config: { root },
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe("/src/farm.routes.js");
        return { default: manifest };
      },
    } as any);
    manager.setRendererRuntime(createTestRendererRuntime() as any);

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
      config: { root },
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe("/src/farm.route.tsx");
        return { Route: ProductRoute };
      },
    } as any);
    manager.setRendererRuntime(createTestRendererRuntime() as any);

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

  it("normalizes typed search params with defaults and temporary keys", async () => {
    function ProductPage() {
      return null;
    }

    const searchSchema = {
      parse: vi.fn((value: any) => ({
        tab: value.tab === "reviews" ? "reviews" : "info",
        locale: value.locale || "en",
        toast: value.toast,
      })),
    };
    const ProductRoute = createRoute("/products/[id]", {
      search: {
        schema: searchSchema,
        stripDefaults: true,
        preserve: ["locale"],
        temporary: ["toast"],
      },
      data: {
        main: async ({ search }) => ({ search }),
      },
      component: ProductPage as any,
    });
    const routeModule = createRouteModuleFromProgrammaticPageForTest(ProductRoute);

    expect((routeModule as any).__farmRouteSchemas.search).toBe(searchSchema);
    expect((routeModule as any).__farmRouteSearch).toEqual({
      stripDefaults: true,
      preserve: ["locale"],
      temporary: ["toast"],
    });

    const resolvedProps = await (routeModule as any).__farmResolveRouteProps({
      params: { id: "123" },
      searchParams: Promise.resolve({ tab: "info", locale: "am", toast: "saved" }),
      path: "/products/123",
    });

    expect(resolvedProps.search).toEqual({
      tab: "info",
      locale: "am",
      toast: "saved",
    });
    expect(resolvedProps.data.search).toEqual(resolvedProps.search);
    expect(resolvedProps.__farmCanonicalPath).toBe("/products/123?locale=am");

    const Page = routeModule.default as any;
    const element = (await Page(resolvedProps)) as any;
    expect(element.props.search).toEqual(resolvedProps.search);
    expect(element.props.__farmCanonicalPath).toBeUndefined();
  });

  it("runs programmatic route guards before data hooks", async () => {
    function DashboardPage() {
      return null;
    }

    const guard = vi.fn(async ({ search }: any) => {
      if (search.token !== "allowed") {
        redirect("/login");
      }
    });
    const main = vi.fn(async () => ({ ok: true }));
    const DashboardRoute = createRoute("/dashboard", {
      search: {
        parse: (value: any) => ({ token: value.token }),
      },
      guard,
      data: {
        main,
      },
      component: DashboardPage as any,
    });

    const routeModule = createRouteModuleFromProgrammaticPageForTest(DashboardRoute);

    await expect(
      (routeModule as any).__farmResolveRouteProps({
        params: {},
        searchParams: Promise.resolve({ token: "nope" }),
        path: "/dashboard",
      }),
    ).rejects.toMatchObject({ digest: "FARM_REDIRECT;307;/login" });

    expect(guard).toHaveBeenCalledTimes(1);
    expect(main).not.toHaveBeenCalled();

    await expect(
      (routeModule as any).__farmResolveRouteProps({
        params: {},
        searchParams: Promise.resolve({ token: "allowed" }),
        path: "/dashboard",
      }),
    ).resolves.toMatchObject({ data: { ok: true } });
    expect(main).toHaveBeenCalledTimes(1);
  });

  it("passes app route context to guards and data without leaking it to components", async () => {
    function DashboardPage() {
      return null;
    }

    const appContext = {
      session: { user: { id: "user-1" } },
      db: { label: "database" },
    };
    const pluginContext = { data: new Map([["traceId", "trace-1"]]) };
    const guard = vi.fn(({ context, pluginContext: exposedPlugins }: any) => {
      expect(context).toBe(appContext);
      expect(exposedPlugins).toBe(pluginContext);
      if (!context.session.user) redirect("/login");
    });
    const before = vi.fn(({ context }: any) => ({
      userId: context.session.user.id,
    }));
    const key = vi.fn(({ context, before }: any) => [
      "dashboard",
      context.session.user.id,
      before.userId,
    ]);
    const main = vi.fn(({ context, before }: any) => ({
      userId: before.userId,
      db: context.db.label,
    }));
    const after = vi.fn(({ context, data }: any) => {
      expect(context).toBe(appContext);
      expect(data.userId).toBe("user-1");
    });

    const DashboardRoute = createRoute("/dashboard", {
      guard,
      data: {
        key,
        before,
        main,
        after,
      },
      component: DashboardPage as any,
    });
    const routeModule = createRouteModuleFromProgrammaticPageForTest(DashboardRoute);
    const props = withFarmRouteContext(
      {
        params: {},
        searchParams: Promise.resolve({}),
        path: "/dashboard",
        context: pluginContext,
      },
      appContext,
    );

    const resolvedProps = await (routeModule as any).__farmResolveRouteProps(props);

    expect(resolvedProps.data).toEqual({ userId: "user-1", db: "database" });
    expect(resolvedProps.context).toBe(pluginContext);
    expect(Object.getOwnPropertySymbols(resolvedProps)).not.toContain(FARM_ROUTE_CONTEXT_SYMBOL);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(before).toHaveBeenCalledTimes(1);
    expect(key).toHaveBeenCalledTimes(1);
    expect(main).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);

    const Page = routeModule.default as any;
    const element = (await Page(props)) as any;

    expect(element.props.context).toBe(pluginContext);
    expect(element.props.context).not.toBe(appContext);
    expect(Object.getOwnPropertySymbols(element.props)).not.toContain(FARM_ROUTE_CONTEXT_SYMBOL);
  });

  it("resolves app route context from config", async () => {
    const request = new Request("https://example.com/products/123?tab=info");
    const context = await resolveFarmRouteContext(
      {
        context: ({ request, params, search, path }) => ({
          host: new URL(request.url).host,
          id: params.id,
          tab: search.tab,
          path,
        }),
      },
      {
        request,
        params: { id: "123" },
        search: { tab: "info" },
        path: "/products/123",
      },
    );

    expect(context).toEqual({
      host: "example.com",
      id: "123",
      tab: "info",
      path: "/products/123",
    });
  });

  it("supports pending, error, and notFound components on programmatic routes", async () => {
    function ProductPage() {
      return null;
    }
    function Pending(props: any) {
      return props;
    }
    function ErrorView(props: any) {
      return props;
    }
    function MissingView(props: any) {
      return props;
    }

    const ErrorRoute = createRoute("/error", {
      data: {
        main: async () => {
          throw new Error("load failed");
        },
      },
      pending: Pending,
      error: ErrorView,
      component: ProductPage as any,
    });
    const MissingRoute = createRoute("/missing", {
      data: {
        main: async () => {
          notFound();
        },
      },
      notFound: MissingView,
      component: ProductPage as any,
    });

    const errorModule = createRouteModuleFromProgrammaticPageForTest(ErrorRoute);
    expect((errorModule as any).__farmRouteComponents.pending).toBe(Pending);
    expect((errorModule as any).__farmRouteComponents.error).toBe(ErrorView);

    const ErrorPage = errorModule.default as any;
    const suspenseElement = ErrorPage({
      params: {},
      searchParams: Promise.resolve({}),
      path: "/error",
    }) as any;

    expect(suspenseElement.props.fallback.type).toBe(Pending);
    const errorElement = await renderSuspendedChild(suspenseElement.props.children);
    expect(errorElement.type).toBe(ErrorView);
    expect(errorElement.props.error).toBeInstanceOf(Error);

    const missingModule = createRouteModuleFromProgrammaticPageForTest(MissingRoute);
    const MissingPage = missingModule.default as any;
    const missingElement = await MissingPage({
      params: {},
      searchParams: Promise.resolve({}),
      path: "/missing",
    });

    expect(missingElement.type).toBe(MissingView);
    expect(missingElement.props.error.digest).toBe("FARM_NOT_FOUND");
  });

  it("preserves pending work without delaying pre-resolved route props", async () => {
    const data = createControlledPromise<{ id: string }>();
    const main = vi.fn(() => data.promise);
    function ProductPage(props: any) {
      return props;
    }
    function Pending() {
      return null;
    }

    const route = createRoute("/products/[id]", {
      data: { main },
      pending: Pending,
      component: ProductPage as any,
    });
    const routeModule = createRouteModuleFromProgrammaticPageForTest(route);
    const Page = routeModule.default as any;
    const inputProps = {
      params: { id: "p1" },
      searchParams: Promise.resolve({}),
      path: "/products/p1",
    };

    const pendingBoundary = Page(inputProps) as any;
    expect(pendingBoundary.props.fallback.type).toBe(Pending);

    let suspension!: Promise<unknown>;
    try {
      pendingBoundary.props.children.type(pendingBoundary.props.children.props);
    } catch (error) {
      suspension = error as Promise<unknown>;
    }
    expect(typeof suspension?.then).toBe("function");
    let settled = false;
    void suspension.then(() => {
      settled = true;
    });
    for (let turn = 0; turn < 5 && main.mock.calls.length === 0; turn += 1) {
      await Promise.resolve();
    }
    expect(main).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    data.resolve({ id: "p1" });
    await suspension;
    const pendingResult = pendingBoundary.props.children.type(pendingBoundary.props.children.props);
    expect(pendingResult.type).toBe(ProductPage);
    expect(pendingResult.props.data).toEqual({ id: "p1" });

    const resolvedProps = await (routeModule as any).__farmResolveRouteProps(inputProps);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    let resolvedContent: any;
    try {
      const resolvedBoundary = Page(resolvedProps) as any;
      resolvedContent = resolvedBoundary.props.children.type(resolvedBoundary.props.children.props);
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect(resolvedContent.type).toBe(ProductPage);
    expect(resolvedContent.props.data).toBe(resolvedProps.data);
  });
});

function createRouteModuleFromProgrammaticPageForTest(
  route: ProgrammaticPageRoute<any, any, any, any>,
) {
  return createRouteModuleFromProgrammaticPage(route, createTestRendererRuntime());
}

function createTestRendererRuntime() {
  return {
    Suspense: Symbol.for("farm.test.suspense"),
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...(props as Record<string, unknown> | undefined),
          ...(children.length > 0
            ? { children: children.length === 1 ? children[0] : children }
            : {}),
        },
      };
    },
  };
}

function createControlledPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderSuspendedChild(element: any): Promise<any> {
  try {
    return element.type(element.props);
  } catch (error) {
    if (!error || typeof (error as PromiseLike<unknown>).then !== "function") throw error;
    try {
      await error;
    } catch {
      // The retry reads the resource's rejected state and renders the route boundary.
    }
    return element.type(element.props);
  }
}
