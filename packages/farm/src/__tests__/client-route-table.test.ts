// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFarmClientRouteTable,
  FARM_CLIENT_ROUTE_TABLE_MODULE,
  generateFarmClientRouteTableModule,
  type FarmClientRouteTableEntry,
} from "../nitro/client-route-table";
import {
  generateClientPageDirectorySource,
  generateFarmClientBootRoutesServerSource,
  generateFarmClientRouteTableRuntime,
} from "../nitro/universal-build";
import { createFarmRouter } from "../router";

const page = (
  pattern: string,
  fields: Partial<Parameters<typeof createFarmClientRouteTable>[0][number]> = {},
) => ({
  pattern,
  pageShouldHydrate: false,
  hasIsolatedClientBoundaries: false,
  islandStrategy: "load" as const,
  ...fields,
});

// Docs entries first, as buildClient puts them; a route group's page carries its directory.
const table = createFarmClientRouteTable([
  page("/docs", { docs: true }),
  page("/docs/[...slug]", { docs: true }),
  page("/", { hasIsolatedClientBoundaries: true }),
  page("/blog", { directory: "/(home)/blog", pageShouldHydrate: true }),
  page("/blog/[slug]", { pageShouldHydrate: true, islandStrategy: "visible" }),
  page("/blog/featured"),
  page("/docs/[[...slug]]", { directory: "/(docs)/docs/[[...slug]]" }),
  page("/files/[...path]", { pageShouldHydrate: true }),
]);

const PATHS = [
  "/",
  "/blog",
  "/blog/",
  "/blog/featured",
  "/blog/hello",
  "/blog/hello/extra",
  "/docs",
  "/docs/installation",
  "/docs/a/b",
  "/files/a/b/c",
  "/missing",
  "/blog/%E2%9C%93",
];

/** The server half: what a document names for a route path. */
function createServer(entries: FarmClientRouteTableEntry[]) {
  return new Function(
    "createFarmRouter",
    `${generateFarmClientBootRoutesServerSource(JSON.stringify(JSON.stringify(entries)))}
return getFarmClientBootRoutes;`,
  )(createFarmRouter) as (
    pathname: string,
  ) => { path: string; routes: FarmClientRouteTableEntry[] } | undefined;
}

/** The client half, with the route table module behind `importTable`. */
function createClient(options: {
  pathname: string;
  boot?: unknown;
  importTable: () => Promise<{ default: FarmClientRouteTableEntry[] }>;
}) {
  const loaders = [0, 1, 2].map((index) => vi.fn(async () => `page ${index}`));
  vi.stubGlobal("window", {
    location: { pathname: options.pathname },
    __FARM_CLIENT_ROUTES__: options.boot,
  });
  const listeners: string[] = [];
  vi.stubGlobal("document", {
    addEventListener: (type: string) => listeners.push(type),
    removeEventListener: () => {},
  });
  const runtime = generateFarmClientRouteTableRuntime({ table: true, docs: true }).replace(
    `import("./${FARM_CLIENT_ROUTE_TABLE_MODULE}")`,
    "__importTable()",
  );
  const client = new Function(
    "createFarmRouter",
    "getFarmRoutePathname",
    "farmClientRouteLoaders",
    "__importTable",
    `${runtime}
${generateClientPageDirectorySource()}
return {
  boot: farmClientRoutesBoot,
  load: loadFarmClientRouteTable,
  match(pathname) {
    const matched = clientRouteMatcher.match(pathname);
    return matched ? { route: matched.route.meta, params: matched.params } : null;
  },
  directory: getFarmPageDirectory,
};`,
  )(createFarmRouter, (pathname: string) => pathname, loaders, options.importTable) as {
    boot: Promise<void> | null;
    load: () => Promise<void> | null;
    match: (pathname: string) => { route: any; params: Record<string, string> } | null;
    directory: (pathname: string) => string | null;
  };
  return { client, loaders, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the client route table", () => {
  it("numbers the loaders of the pages that hydrate, in table order", () => {
    expect(table.filter((entry) => entry.loader !== undefined)).toEqual([
      expect.objectContaining({ pattern: "/blog", directory: "/(home)/blog", loader: 0 }),
      expect.objectContaining({ pattern: "/blog/[slug]", islandStrategy: "visible", loader: 1 }),
      expect.objectContaining({ pattern: "/files/[...path]", loader: 2 }),
    ]);
    expect(table[0]).toEqual({
      pattern: "/docs",
      pageShouldHydrate: false,
      docs: true,
      islandStrategy: "load",
    });
    const source = generateFarmClientRouteTableModule(table);
    expect(new Function(source.replace("export default", "return"))()).toEqual(table);
  });

  it("names, for every path, the entries the client matches with the whole table", async () => {
    const getBootRoutes = createServer(table);
    const full = createClient({
      pathname: "/elsewhere",
      importTable: async () => ({ default: table }),
    }).client;
    await full.boot;

    for (const pathname of PATHS) {
      const boot = getBootRoutes(pathname)!;
      expect(boot.path).toBe(pathname);
      const { client } = createClient({
        pathname,
        boot: JSON.parse(JSON.stringify(boot)),
        importTable: () => {
          throw new Error("the document named this page's entries");
        },
      });
      expect(client.boot).toBeNull();
      const matched = client.match(pathname);
      const expected = full.match(pathname);
      expect(
        matched && { pattern: matched.route.pattern, params: matched.params },
        pathname,
      ).toEqual(expected && { pattern: expected.route.pattern, params: expected.params });
      expect(client.directory(pathname), pathname).toBe(full.directory(pathname));
      expect(boot.routes.length).toBeLessThanOrEqual(2);
    }
  });

  it("boots without the table and loads it once, on the first call that needs it", async () => {
    const importTable = vi.fn(async () => ({ default: table }));
    const { client, loaders, listeners } = createClient({
      pathname: "/blog/hello",
      boot: createServer(table)("/blog/hello"),
      importTable,
    });
    expect(client.boot).toBeNull();
    // The booting page's own loader, by its index.
    await expect(client.match("/blog/hello")!.route.load()).resolves.toBe("page 1");
    expect(client.match("/files/a")).toBeNull();
    expect(importTable).not.toHaveBeenCalled();
    // A plain link reached by the pointer or focus warms the table.
    expect(listeners).toEqual(["pointerover", "pointerdown", "focusin", "touchstart"]);

    const first = client.load();
    expect(client.load()).toBe(first);
    await first;
    expect(importTable).toHaveBeenCalledTimes(1);
    expect(client.load()).toBeNull();
    const files = client.match("/files/a/b")!;
    expect(files.route).toMatchObject({ pattern: "/files/[...path]", navigation: "html-fragment" });
    await expect(files.route.load()).resolves.toBe("page 2");
    expect(loaders[2]).toHaveBeenCalledTimes(1);
    expect(client.match("/blog/featured")!.route.load).toBeNull();
  });

  it("waits for the table when the document named entries for another URL, or none", async () => {
    for (const boot of [createServer(table)("/blog/hello"), undefined, { path: "/blog" }]) {
      const importTable = vi.fn(async () => ({ default: table }));
      const { client } = createClient({ pathname: "/blog", boot, importTable });
      expect(importTable).toHaveBeenCalledTimes(1);
      await client.boot;
      expect(client.match("/blog")!.route.pattern).toBe("/blog");
      expect(client.directory("/blog")).toBe("/(home)/blog");
    }
  });

  it("keeps the booting entries when the table fails to load, and loads it again later", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const importTable = vi
      .fn<() => Promise<{ default: FarmClientRouteTableEntry[] }>>()
      .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"))
      .mockResolvedValue({ default: table });
    const { client } = createClient({ pathname: "/blog", importTable });
    await client.boot;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(client.match("/blog")).toBeNull();

    await client.load();
    expect(importTable).toHaveBeenCalledTimes(2);
    expect(client.match("/blog")!.route.pattern).toBe("/blog");
  });

  describe("a navigation before the table has loaded", () => {
    // The navigate method of the client entry with client routes, run as emitted.
    const source = readFileSync(new URL("../nitro/universal-build.ts", import.meta.url), "utf8");
    const navigate = [...source.matchAll(/ {2}navigate: async function\([^]*?\n {2}},/g)]
      .map(([method]) => method)
      .find((method) => method.includes("loadFarmClientRouteTable()"));

    function setup(table: Promise<void>, prefetch = true) {
      const order: string[] = [];
      const window = {
        location: {
          href: "https://example.test/notes",
          origin: "https://example.test",
          pathname: "/notes",
          search: "",
          hash: "",
          assign: vi.fn(),
          replace: vi.fn(),
        },
        history: { state: null },
      };
      const runtime = {
        beginNavigation: vi.fn(async () => {
          throw new Error("stop after starting");
        }),
        failNavigation: vi.fn(),
        cancelNavigation: vi.fn(),
      };
      const router = new Function(
        "window",
        "farmClientRuntime",
        "loadFarmClientRouteTable",
        "order",
        "farmPrefetchWhileRouteTableLoads",
        `
          const isFarmExternalNavigationURL = (url, origin) => url.origin !== origin;
          const isFarmBlockedNavigationURL = () => false;
          const isFarmDocsPath = () => false;
          const runFarmNavigationDelegates = async () => false;
          const matchRoute = (pathname) => { order.push("match " + pathname); return null; };
          const cancelPendingPageHydration = () => {};
          return {
            currentPath: "/notes",
            currentHistoryState: null,
            prefetch(href) { order.push("prefetch " + href); },
            shouldBlockNavigation: async () => false,
            cancelActiveNavigation() {},
            stopNavigationStream() {},
            saveScrollPosition() {},
            startNavigation() { return {}; },
            finishNavigation() {},
            ${navigate}
          };
        `,
      )(window, runtime, () => table, order, prefetch);
      vi.stubGlobal("console", { ...console, warn: vi.fn(), error: vi.fn() });
      return { router, window, order };
    }

    it("fetches the page meanwhile, then matches the route against the whole table", async () => {
      expect(navigate).toBeDefined();
      let resolve!: () => void;
      const { router, order } = setup(new Promise<void>((done) => (resolve = done)));
      const navigation = router.navigate("/blog/hello?tab=1");
      await Promise.resolve();
      expect(order).toEqual(["prefetch https://example.test/blog/hello?tab=1"]);
      resolve();
      await navigation.catch(() => {});
      expect(order.slice(0, 2)).toEqual([
        "prefetch https://example.test/blog/hello?tab=1",
        "match /blog/hello",
      ]);
    });

    it("leaves a streaming navigation's page to the navigation (islands mode)", async () => {
      const { router, order } = setup(Promise.resolve(), false);
      await router.navigate("/stream").catch(() => {});
      expect(order[0]).toBe("match /stream");
    });

    it.each([
      ["push", {}, "assign"],
      ["replace", { replace: true }, "replace"],
      ["back/forward", { action: "pop", popState: null }, "replace"],
    ] as const)(
      "without the table, loads the next page as a document (%s)",
      async (_name, options, method) => {
        const { router, window, order } = setup(Promise.reject(new Error("404")));
        await router.navigate("/blog/hello", options);
        expect(window.location[method]).toHaveBeenCalledWith("https://example.test/blog/hello");
        expect(order.filter((step) => !step.startsWith("prefetch"))).toEqual([]);
      },
    );
  });

  it("never loads a table for an app without client routes", () => {
    const runtime = generateFarmClientRouteTableRuntime({ table: false, docs: false });
    expect(runtime).not.toContain("import(");
    const client = new Function(
      "createFarmRouter",
      `${runtime}\nreturn { boot: farmClientRoutesBoot, load: loadFarmClientRouteTable, matcher: clientRouteMatcher };`,
    )(createFarmRouter);
    expect(client.boot).toBeNull();
    expect(client.load()).toBeNull();
    expect(client.matcher.match("/")).toBeNull();
    expect(createServer([])("/")).toBeUndefined();
  });
});
