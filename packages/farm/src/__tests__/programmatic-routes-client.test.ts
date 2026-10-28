// @vitest-environment node

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build, createServer, type Plugin, type Rollup } from "vite";
import { build as buildApp } from "../build";
import { resolveConfig } from "../config";
import { farmEnvironmentFunctionsPlugin } from "../environment-vite";
import {
  generateProgrammaticClientRouteModule,
  programmaticClientRouteKey,
  resolveProgrammaticClientRoutes,
  type ProgrammaticClientRoutes,
  type ProgrammaticRouteGraph,
  type ProgrammaticRouteGraphModule,
} from "../programmatic-routes-client";
import { createRoute, createRouteModuleFromProgrammaticPage } from "../routes";
import { RouteManager } from "../routing/route-manager";
import { normalizeProgrammaticRoutePath } from "../routes-shared";
import { farmPlugin } from "../vite";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function graphOf(modules: ProgrammaticRouteGraphModule[]): ProgrammaticRouteGraph {
  const byId = new Map(modules.map((module) => [module.id, module]));
  return {
    getModuleById: (id) => byId.get(id),
    getModulesByFile: (file) => modules.filter((module) => module.file === file),
  };
}

const resolve = (graph: ProgrammaticRouteGraph, routes: unknown[]) =>
  resolveProgrammaticClientRoutes({
    graph,
    routesFile: "/app/src/routes.tsx",
    routes,
    normalizeRoutePath: normalizeProgrammaticRoutePath,
  });
const routeAt = (result: ProgrammaticClientRoutes, routePath: string, kind = "page" as const) =>
  result.routes.get(programmaticClientRouteKey("/app/src/routes.tsx", kind, routePath));

describe("resolving programmatic route components", () => {
  function AdminPage() {
    return null;
  }
  function Pending() {
    return null;
  }

  it("finds the module that defines a component, past barrels that re-export it", () => {
    const routes = [
      { kind: "page", path: "/admin/", component: AdminPage, pending: Pending, guard() {} },
      { kind: "layout", path: "/admin", component: Pending },
    ];
    const result = resolve(
      graphOf([
        {
          id: "/app/src/routes.tsx",
          file: "/app/src/routes.tsx",
          imports: ["/app/src/features/index.ts", "/app/src/db.ts"],
          exports: { default: { __farmRoutes: true, routes } },
        },
        { id: "/app/src/db.ts", file: "/app/src/db.ts", imports: [], exports: { db: {} } },
        {
          id: "/app/src/features/index.ts",
          file: "/app/src/features/index.ts",
          imports: ["/app/src/features/admin.tsx"],
          exports: { AdminPage, Pending },
        },
        {
          id: "/app/src/features/admin.tsx",
          file: "/app/src/features/admin.tsx",
          imports: [],
          exports: { AdminPage, Pending },
        },
      ]),
      routes,
    );

    expect(routeAt(result, "/admin")).toEqual({
      kind: "page",
      path: "/admin",
      routesFile: "/app/src/routes.tsx",
      component: { file: "/app/src/features/admin.tsx", exportName: "AdminPage" },
      pending: { file: "/app/src/features/admin.tsx", exportName: "Pending" },
      serverProps: ["guard"],
    });
    expect(routeAt(result, "/admin", "layout" as any)?.component?.exportName).toBe("Pending");
    expect([...result.routeSourceFiles]).toEqual(["/app/src/routes.tsx"]);
  });

  it("records what the server resolves, however the options were set", () => {
    const route: Record<string, unknown> = { kind: "page", path: "/docs", component: AdminPage };
    route.data = { main: () => ({}) };
    route.search = { parse: (value: unknown) => value };
    const result = resolve(
      graphOf([
        {
          id: "/app/src/routes.tsx",
          file: "/app/src/routes.tsx",
          imports: ["/app/src/page.tsx"],
          exports: { default: [route] },
        },
        { id: "/app/src/page.tsx", file: "/app/src/page.tsx", imports: [], exports: { AdminPage } },
      ]),
      [route],
    );
    expect(routeAt(result, "/docs")?.serverProps).toEqual(["search", "data"]);
  });

  it("refuses components with no module of their own", () => {
    function Inline() {
      return null;
    }
    function Exported() {
      return null;
    }
    function FromPackage() {
      return null;
    }
    const routes = [
      { kind: "page", path: "/inline", component: Inline },
      { kind: "page", path: "/exported", component: Exported },
      { kind: "page", path: "/package", component: FromPackage },
      { kind: "page", path: "/sibling", component: AdminPage },
    ];
    const result = resolve(
      graphOf([
        {
          id: "/app/src/routes.tsx",
          file: "/app/src/routes.tsx",
          imports: ["pkg", "/app/src/admin/routes.ts"],
          exports: { default: routes, Exported },
        },
        { id: "pkg", imports: [], exports: { FromPackage }, external: true },
        {
          id: "/app/src/admin/routes.ts",
          file: "/app/src/admin/routes.ts",
          imports: [],
          exports: { AdminPage, adminRoutes: [routes[3]] },
        },
      ]),
      routes,
    );

    expect(routeAt(result, "/inline")?.problem).toMatch(/not exported by any module/);
    expect(routeAt(result, "/exported")?.problem).toMatch(/routes\.tsx, which defines routes/);
    expect(routeAt(result, "/package")?.problem).toMatch(/comes from a package/);
    expect(routeAt(result, "/sibling")?.problem).toMatch(/admin\/routes\.ts, which defines routes/);
    expect([...result.routeSourceFiles].sort()).toEqual([
      "/app/src/admin/routes.ts",
      "/app/src/routes.tsx",
    ]);
  });
});

describe("generated client route modules", () => {
  const base = {
    routesFile: "/app/src/routes.tsx",
    rendererServer: "@farm.js/core/renderer/react/server",
    toImportSpecifier: (file: string) => file.replace("/app", ""),
  };

  it("import only the component module", () => {
    const code = generateProgrammaticClientRouteModule({
      ...base,
      kind: "page",
      routePath: "/admin",
      route: {
        kind: "page",
        path: "/admin",
        routesFile: base.routesFile,
        component: { file: "/app/src/admin.tsx", exportName: "AdminPage" },
        pending: { file: "/app/src/pending.tsx", exportName: "default" },
        serverProps: ["guard", "data"],
      },
    });

    expect(code).toContain('import { AdminPage as __farmComponent } from "/src/admin.tsx";');
    expect(code).toContain('import __farmPending from "/src/pending.tsx";');
    expect(code).toContain('__farmServerHooks: ["guard","data"]');
    expect(code).not.toContain("routes.tsx");
    expect(code).not.toMatch(/\b(guard|data|staticPaths|generateMetadata|methods)\s*:/);
  });

  it("re-export a component that needs no wrapper", () => {
    const code = generateProgrammaticClientRouteModule({
      ...base,
      kind: "layout",
      routePath: "/admin",
      route: {
        kind: "layout",
        path: "/admin",
        routesFile: base.routesFile,
        component: { file: "/app/src/shell.tsx", exportName: "my-shell" },
      },
    });
    expect(code).toBe(
      'import { "my-shell" as __farmComponent } from "/src/shell.tsx";\nexport default __farmComponent;\n',
    );
  });

  it("fail with the route and file when a component has no module", () => {
    const generate = () =>
      generateProgrammaticClientRouteModule({
        ...base,
        kind: "page",
        routePath: "/admin",
        route: {
          kind: "page",
          path: "/admin",
          routesFile: base.routesFile,
          problem: "its component is not exported by any module the routes file imports",
        },
      });
    expect(generate).toThrow(
      /route "\/admin" in \/app\/src\/routes\.tsx renders in the browser, but its component is not exported.*move the component to its own module/,
    );
  });

  it("never generate a browser copy of an API route or an unknown route", () => {
    expect(() =>
      generateProgrammaticClientRouteModule({
        ...base,
        kind: "api",
        routePath: "/feed",
        route: undefined,
      }),
    ).toThrow(/server-only/);
    expect(() =>
      generateProgrammaticClientRouteModule({
        ...base,
        kind: "page",
        routePath: "/gone",
        route: undefined,
      }),
    ).toThrow(/did not find it/);
  });
});

const COMPONENTS = {
  "src/components/counter.tsx": `"use client";
export function Counter() {
  return <button>CLIENT_COUNTER_MARKER</button>;
}
`,
  "src/components/pages.tsx": `import { Counter } from "./counter";
export function DocPage({ data }: any) {
  return <main>CLIENT_COMPONENT_MARKER {data?.title}<Counter /></main>;
}
export function DocPending() {
  return <p>CLIENT_PENDING_MARKER</p>;
}
export default function AdminShell({ children }: any) {
  return <section>CLIENT_LAYOUT_MARKER{children}</section>;
}
`,
  "src/components/index.ts": `export { DocPage, DocPending, default as AdminShell } from "./pages";
`,
  "src/db.ts": `globalThis.__farmPool = "postgres://app:DB_PASSWORD_SECRET@db.internal/app";
export const db = { find: async (id: string) => ({ id, title: "PRIVATE_ROW_" + id }) };
`,
  "src/guards.ts": `export function requireAdmin() {
  throw new Error("GUARD_SECRET_MESSAGE");
}
`,
  // Two modules deep, through a named export, as raw definitions.
  "src/admin/pages.ts": `import type { ProgrammaticRouteDefinition } from "@farm.js/core";
import { db } from "../db";
import { requireAdmin } from "../guards";
import { DocPage } from "../components";
export const userPages: ProgrammaticRouteDefinition[] = [
  { kind: "page", path: "/admin/users", component: DocPage, guard: requireAdmin,
    data: { main: () => db.find("users") } },
];
`,
  "src/admin/index.ts": `import { userPages } from "./pages";
export const adminRoutes = [...userPages];
`,
  // A package helper wrapping page().
  "node_modules/@acme/route-kit/package.json": JSON.stringify({
    name: "@acme/route-kit",
    type: "module",
    exports: "./index.js",
  }),
  "node_modules/@acme/route-kit/index.js": `import { page } from "@farm.js/core";
export function securePage(path, options) {
  return page(path, { ...options, guard: () => { throw new Error("KIT_GUARD_SECRET"); } });
}
`,
};

const ROUTES = `import {
  defineRoutes,
  page,
  routesBuilder,
  type ProgrammaticRouteDefinition,
} from "@farm.js/core";
import { securePage } from "@acme/route-kit";
import { db } from "./db";
import { requireAdmin } from "./guards";
import { adminRoutes } from "./admin";
import { AdminShell, DocPage, DocPending } from "./components";

const { page: aliasedPage } = routesBuilder;
const assigned = page("/assigned", { component: DocPage });
assigned.data = { main: () => db.find("assigned") };

const typed: ProgrammaticRouteDefinition[] = [
  { kind: "page", path: "/typed", component: DocPage, guard: requireAdmin,
    data: { main: () => db.find("typed") } },
  { kind: "layout", path: "/admin", component: AdminShell,
    generateMetadata: async () => ({ title: "PRIVATE_METADATA_SECRET" }) },
];

export default defineRoutes(({ api }) => [
  ...typed,
  ...adminRoutes,
  securePage("/kit", { component: DocPage, data: { main: () => db.find("kit") } }),
  assigned,
  routesBuilder.page("/builder", { component: DocPage, pending: DocPending, guard: requireAdmin }),
  aliasedPage("/aliased", { component: DocPage, staticPaths: async () => [db.find("paths")] }),
  api("/api/secret", { GET: async () => Response.json(await db.find("API_HANDLER_SECRET")) }),
]);
`;

const SERVER_MARKERS = [
  "DB_PASSWORD_SECRET",
  "GUARD_SECRET_MESSAGE",
  "KIT_GUARD_SECRET",
  "PRIVATE_METADATA_SECRET",
  "API_HANDLER_SECRET",
];

function createRoutesFixture(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(path.join(packageRoot, ".tmp-programmatic-client-")));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  symlinkSync(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  }
  return root;
}

/** Discover the app's routes on the server, as `farm dev` and `farm build` do. */
async function evaluateRoutes(root: string): Promise<ProgrammaticClientRoutes> {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["@farm.js/core"] },
  });
  try {
    const config = await resolveConfig({ root, srcDir: "src" }, "development");
    const manager = new RouteManager(config as any, server);
    await manager.discoverRoutes();
    return manager.getProgrammaticClientRoutes();
  } finally {
    await server.close();
  }
}

async function buildClient(
  root: string,
  clientRoutes: ProgrammaticClientRoutes,
  entries: string[],
): Promise<string> {
  const entry = path.join(root, "client-entry.js");
  writeFileSync(
    entry,
    entries.map((id, index) => `export * as route${index} from ${JSON.stringify(id)};`).join("\n"),
  );
  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [
      // The route module ids the client entry imports, as Farm's client entry does.
      {
        name: "test:farm-route-ids",
        enforce: "pre",
        resolveId: (source) => (source.includes("?farm-route=") ? source : null),
      } satisfies Plugin,
      farmPlugin({ root, srcDir: "src", programmaticClientRoutes: clientRoutes }),
      farmEnvironmentFunctionsPlugin({ root, srcDir: "src" }),
    ],
    build: {
      write: false,
      minify: false,
      target: "esnext",
      rollupOptions: {
        input: entry,
        preserveEntrySignatures: "strict",
        external: (id) =>
          id.startsWith("@farm.js/core") || id === "react" || id.startsWith("react/"),
      },
    },
  });
  return (Array.isArray(result) ? result : [result])
    .flatMap((output) => (output as Rollup.RollupOutput).output)
    .filter((item): item is Rollup.OutputChunk => item.type === "chunk")
    .map((chunk) => chunk.code)
    .join("\n");
}

function readJavaScript(directory: string): string {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

const routeId = (root: string, kind: string, routePath: string) =>
  `${path.join(root, "src", "routes.tsx")}?farm-route=${kind}:${encodeURIComponent(routePath)}&lang.js`;

describe("programmatic routes in the client build", () => {
  it("ships components without the routes file's server code, whatever builds the routes", async () => {
    const root = createRoutesFixture({ ...COMPONENTS, "src/routes.tsx": ROUTES });
    const clientRoutes = await evaluateRoutes(root);
    const pages = ["/typed", "/admin/users", "/kit", "/assigned", "/builder", "/aliased"];

    const code = await buildClient(root, clientRoutes, [
      ...pages.map((routePath) => routeId(root, "page", routePath)),
      routeId(root, "layout", "/admin"),
    ]);
    expect(code).toContain("CLIENT_COMPONENT_MARKER");
    expect(code).toContain("CLIENT_PENDING_MARKER");
    expect(code).toContain("CLIENT_LAYOUT_MARKER");
    expect(code).toContain("CLIENT_COUNTER_MARKER");
    expect(SERVER_MARKERS.filter((marker) => code.includes(marker))).toEqual([]);

    // Each component comes from the module that defines it, past the barrel that re-exports it.
    expect(
      pages.map((routePath) => {
        const route = clientRoutes.routes.get(
          programmaticClientRouteKey(path.join(root, "src", "routes.tsx"), "page", routePath),
        );
        return [routePath, route?.component?.file.replace(root, ""), route?.serverProps];
      }),
    ).toEqual([
      ["/typed", "/src/components/pages.tsx", ["guard", "data"]],
      ["/admin/users", "/src/components/pages.tsx", ["guard", "data"]],
      ["/kit", "/src/components/pages.tsx", ["guard", "data"]],
      ["/assigned", "/src/components/pages.tsx", ["data"]],
      ["/builder", "/src/components/pages.tsx", ["guard"]],
      ["/aliased", "/src/components/pages.tsx", undefined],
    ]);
    expect([...clientRoutes.routeSourceFiles].map((file) => file.replace(root, "")).sort()).toEqual(
      ["/src/admin/index.ts", "/src/admin/pages.ts", "/src/routes.tsx"],
    );
  }, 60_000);

  it("fails the build for a hydrating page whose component lives in the routes file", async () => {
    const root = createRoutesFixture({
      ...COMPONENTS,
      "src/routes.tsx": `import { defineRoutes, page } from "@farm.js/core";
import { requireAdmin } from "./guards";
function InlinePage() {
  return <main>INLINE</main>;
}
export default defineRoutes([page("/inline", { component: InlinePage, guard: requireAdmin })]);
`,
    });
    const clientRoutes = await evaluateRoutes(root);

    await expect(
      buildClient(root, clientRoutes, [routeId(root, "page", "/inline")]),
    ).rejects.toThrow(
      /route "\/inline" in .*routes\.tsx renders in the browser, but its component is not exported by any module the routes file imports.*move the component to its own module/s,
    );
  }, 60_000);

  it("fails the build when a browser module imports a module that defines routes", async () => {
    const root = createRoutesFixture({
      ...COMPONENTS,
      "src/routes.tsx": `import { defineRoutes } from "@farm.js/core";
import { adminRoutes } from "./admin";
export default defineRoutes([...adminRoutes]);
`,
      "src/components/nav.tsx": `import { userPages } from "../admin/pages";
export function Nav() {
  return <nav>{userPages.map((route) => route.path).join(",")}</nav>;
}
`,
    });
    const clientRoutes = await evaluateRoutes(root);
    const entry = path.join(root, "src", "components", "nav.tsx");

    await expect(buildClient(root, clientRoutes, [entry])).rejects.toThrow(
      /admin\/pages\.ts defines programmatic routes, but the browser bundle imports it \(from .*nav\.tsx\)/,
    );
  }, 60_000);

  it("keeps the routes file out of a production client build", async () => {
    const root = createRoutesFixture({
      ...COMPONENTS,
      "src/routes.tsx": ROUTES,
      "src/app/layout.tsx": `export default function RootLayout({ children }: any) {
  return <html><body>{children}</body></html>;
}
`,
    });
    const config = await resolveConfig(
      { root, srcDir: "src", images: { provider: "none" } },
      "production",
    );
    await buildApp(config, { root, preset: "node-server" });

    const code = readJavaScript(path.join(root, ".farm", "client"));
    expect(code).toContain("CLIENT_COMPONENT_MARKER");
    expect(code).toContain("CLIENT_LAYOUT_MARKER");
    expect(SERVER_MARKERS.filter((marker) => code.includes(marker))).toEqual([]);
  }, 180_000);

  it("serves development the same browser copy, and refuses the routes file", async () => {
    const root = createRoutesFixture({ ...COMPONENTS, "src/routes.tsx": ROUTES });
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      appType: "custom",
      server: { middlewareMode: true, hmr: false, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
      ssr: { external: ["@farm.js/core"] },
      plugins: [
        farmPlugin({ root, srcDir: "src" }),
        farmEnvironmentFunctionsPlugin({ root, srcDir: "src" }),
      ],
    });
    try {
      const client = server.environments.client;
      const result = await client.transformRequest(
        `/src/routes.tsx?farm-route=page:${encodeURIComponent("/kit")}&lang.js`,
      );
      expect(result?.code).toContain("/src/components/pages.tsx");
      expect(result?.code).not.toMatch(/routes\.tsx|db\.ts|guards\.ts|route-kit/);
      await expect(client.transformRequest("/src/admin/pages.ts")).rejects.toThrow(
        /defines programmatic routes, but the browser bundle imports it/,
      );
    } finally {
      await server.close();
    }
  }, 60_000);

  it("leaves the server build its route hooks", async () => {
    const route = createRoute("/docs/[id]", {
      component: () => null,
      data: { main: () => ({}) },
    });
    const mod = createRouteModuleFromProgrammaticPage(route, {
      createElement: () => null,
      Suspense: "Suspense",
    } as any) as any;
    expect(mod.__farmRouteData).toBe(route.data);
    expect(mod.default.__farmServerProps).toBeUndefined();
  });
});

describe("client copies of programmatic pages", () => {
  const runtime = {
    createElement: (type: unknown, props: unknown) => ({ type, props }),
    Suspense: "Suspense",
  } as any;
  function Page() {
    return null;
  }

  it("render only server-resolved props once guard and data were removed", async () => {
    const route = createRoute("/docs/[id]", {
      component: Page,
      __farmServerHooks: ["guard", "data"],
    } as any);
    const mod = createRouteModuleFromProgrammaticPage(route, runtime) as any;

    expect(mod.default.__farmServerProps).toBe(true);
    await expect(
      mod.__farmResolveRouteProps({ params: { id: "1" }, searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/resolves its guard and data on the server/);
    // Synchronous, so production and dev hydration can render it.
    expect(mod.default.constructor.name).toBe("Function");
    expect(() => mod.default({ params: { id: "1" } })).toThrow(/server-resolved props/);
    const element = mod.default({
      params: { id: "1" },
      data: { title: "server" },
      __farmRoutePropsResolved: true,
    });
    expect(element).toMatchObject({ type: Page, props: { data: { title: "server" } } });
  });

  it("leave server copies unmarked", () => {
    const route = createRoute("/docs/[id]", { component: Page, data: { main: () => ({}) } });
    const mod = createRouteModuleFromProgrammaticPage(route, runtime) as any;
    expect(mod.default.__farmServerProps).toBeUndefined();
  });
});
