// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build, type Rollup } from "vite";
import { farmEnvironmentFunctionsPlugin } from "../environment-vite";
import { createRoute, createRouteModuleFromProgrammaticPage } from "../routes";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const SERVER_FILES = {
  "db.ts": `
globalThis.__farmPool = "postgres://app:DB_PASSWORD_SECRET@db.internal/app";
export const db = {
  async find(id: string) {
    return { id, title: "PRIVATE_ROW_" + id };
  },
};
`,
  "fs-reader.ts": `
import { readFileSync } from "node:fs";
export function readPrivateFile() {
  return readFileSync("/etc/FS_READER_SECRET", "utf8");
}
`,
  "components.tsx": `
export function DocPage({ data }: any) {
  return <main>CLIENT_COMPONENT_MARKER {data?.title}</main>;
}
export function DocNotFound() {
  return <main>CLIENT_NOT_FOUND_MARKER</main>;
}
`,
};

const ROUTES = `
import { createRoute, defineRoutes } from "@farm.js/core";
import { db } from "./db";
import { readPrivateFile } from "./fs-reader";
import { DocNotFound, DocPage } from "./components";

const owners: Record<string, string> = { "42": "OWNER_TABLE_SECRET" };

async function loadDoc(id: string) {
  return db.find(id);
}

export const DocRoute = createRoute("/docs/[id]", {
  params: { parse: (value: any) => value },
  async guard({ params, context }: any) {
    if (owners[params.id] !== context.userId) throw new Error("GUARD_SECRET_MESSAGE");
  },
  data: {
    async main({ params }: any) {
      return loadDoc(params.id);
    },
  },
  async generateMetadata({ params }: any) {
    return { title: (await loadDoc(params.id)).title };
  },
  staticPaths: () => [{ id: readPrivateFile() }],
  notFound: DocNotFound,
  component: DocPage,
});

export default defineRoutes(({ page, api }) => [
  DocRoute,
  page("/about", {
    data: { main: () => db.find("about") },
    component: DocPage,
  }),
  api("/export.json", {
    runtime: "node",
    GET: async () => Response.json({ file: readPrivateFile() }),
  }),
]);
`;

describe("programmatic routes in the client build", () => {
  it.each([false, true])(
    "keeps guards, data, metadata, static paths, API handlers, and their imports out of the browser (through a route module: %s)",
    async (viaRouteModule) => {
      const output = await buildRoutes(ROUTES, { ssr: false, viaRouteModule });

      for (const secret of [
        "DB_PASSWORD_SECRET",
        "PRIVATE_ROW_",
        "FS_READER_SECRET",
        "OWNER_TABLE_SECRET",
        "GUARD_SECRET_MESSAGE",
        "node:fs",
      ]) {
        expect(output, secret).not.toContain(secret);
      }
      expect(output).toContain("CLIENT_COMPONENT_MARKER");
      expect(output).toContain("CLIENT_NOT_FOUND_MARKER");
      expect(output).toContain("/docs/[id]");
      expect(output).toContain("__farmServerHooks");
      expect(output).toContain('"node"');
    },
  );

  it("leaves the server build untouched", async () => {
    const output = await buildRoutes(ROUTES, { ssr: true });

    expect(output).toContain("DB_PASSWORD_SECRET");
    expect(output).toContain("GUARD_SECRET_MESSAGE");
    expect(output).toContain("OWNER_TABLE_SECRET");
    expect(output).not.toContain("__farmServerHooks");
  });

  it("fails the client build when the routes module itself still needs a Node builtin", async () => {
    await expect(
      buildRoutes(
        `
import { readFileSync } from "node:fs";
import { createRoute } from "@farm.js/core";
const banner = readFileSync("/etc/banner", "utf8");
export const Home = createRoute("/", { component: () => <main>{banner}</main> });
`,
        { ssr: false },
      ),
    ).rejects.toThrow(/still imports the server-only module "node:fs"/);
  });

  it("fails the client build when a component the routes keep reaches a Node builtin", async () => {
    await expect(
      buildRoutes(
        `
import { createRoute } from "@farm.js/core";
import { readPrivateFile } from "./fs-reader";
export const Home = createRoute("/", { component: () => <main>{readPrivateFile()}</main> });
`,
        { ssr: false },
      ),
    ).rejects.toThrow(/reaches the server-only module ".*fs.*" through the programmatic routes/);
  });
  it.each([
    ["imported handlers", `api("/api/users", handlers)`, "are not an object literal"],
    ["spread handlers", `api("/api/users", { ...handlers })`, "spread another object"],
    ["page options by reference", `page("/admin", adminOptions)`, "are not an object literal"],
    ["a computed key", 'api("/api/users", { [method]: handlers.GET })', "use a computed key"],
  ])("refuses route options the client build can't strip: %s", async (_name, call, problem) => {
    await expect(
      buildRoutes(
        `
import { defineRoutes } from "@farm.js/core";
import { db } from "./db";
const handlers = { GET: async () => Response.json(await db.find("1")) };
const adminOptions = { guard: () => db.find("admin"), component: () => null };
const method = "GET";
export default defineRoutes(({ api, page }) => [${call}]);
`,
        { ssr: false },
      ),
    ).rejects.toThrow(
      `in ${call}, the ${call.slice(0, call.indexOf("("))}() route options ${problem}`,
    );
  });

  it("still strips string-literal computed keys", async () => {
    const output = await buildRoutes(
      `
import { defineRoutes } from "@farm.js/core";
import { db } from "./db";
export default defineRoutes(({ api }) => [api("/api/users", { ["GET"]: () => db.find("1") })]);
`,
      { ssr: false },
    );
    expect(output).not.toContain("DB_PASSWORD_SECRET");
  });

  it.each([
    [
      "route definition objects",
      `import { defineRoutes } from "@farm.js/core";
const definitions = [
  { kind: "page", path: "/admin", component: DocPage, guard: () => db.find("admin"), data: { main: () => db.find("1") } },
  { kind: "api", path: "/api/x", methods: { GET: () => db.find("2") } },
  { kind: "layout", path: "/", component: DocPage, generateMetadata: () => db.find("3") },
];
export default defineRoutes(definitions);`,
    ],
    [
      "routesBuilder",
      `import { defineRoutes, routesBuilder } from "@farm.js/core";
export default defineRoutes([
  routesBuilder.page("/admin", { component: DocPage, guard: () => db.find("admin") }),
  routesBuilder.api("/api/x", { GET: () => db.find("2") }),
]);`,
    ],
    [
      "routesBuilder through the module namespace",
      `import * as farm from "@farm.js/core";
export default farm.defineRoutes([
  farm.routesBuilder.page("/admin", { component: DocPage, data: { main: () => db.find("1") } }),
]);`,
    ],
    [
      "a const alias",
      `import { defineRoutes, page as definePage } from "@farm.js/core";
const p = definePage;
export default defineRoutes([p("/admin", { component: DocPage, data: { main: () => db.find("1") } })]);`,
    ],
    [
      "a builder destructured inside the callback",
      `import { defineRoutes } from "@farm.js/core";
export default defineRoutes((r) => {
  const { page, api: route } = r;
  return [
    page("/admin", { component: DocPage, data: { main: () => db.find("1") } }),
    route("/api/x", { GET: () => db.find("2") }),
  ];
});`,
    ],
    [
      "a named routes callback",
      `import { defineRoutes, type ProgrammaticRouteBuilder } from "@farm.js/core";
function routes(b: ProgrammaticRouteBuilder) {
  return [b.page("/admin", { component: DocPage, guard: () => db.find("admin") })];
}
export default defineRoutes(routes);`,
    ],
  ])("strips server-only keys from %s", async (_name, routes) => {
    const source = `import { db } from "./db";
import { DocPage } from "./components";
${routes}`;
    for (const viaRouteModule of [false, true]) {
      const output = await buildRoutes(source, { ssr: false, viaRouteModule });
      expect(output).not.toContain("DB_PASSWORD_SECRET");
      expect(output).not.toContain("PRIVATE_ROW_");
      expect(output).toContain("CLIENT_COMPONENT_MARKER");
    }
  });

  it("keeps an empty methods map on API definition objects", async () => {
    const output = await buildRoutes(
      `
import { defineRoutes } from "@farm.js/core";
import { db } from "./db";
export default defineRoutes([{ kind: "api", path: "/api/x", runtime: "node", methods: { GET: () => db.find("1") } }]);
`,
      { ssr: false },
    );
    expect(output).not.toContain("DB_PASSWORD_SECRET");
    expect(output).toMatch(/methods: \{\}/);
    expect(output).toContain('"node"');
  });

  it.each([
    [
      "a builder passed to a helper",
      `const wrap = (factory: any) => factory("/admin", { component: () => null, guard: () => db.find("1") });
export default defineRoutes(({ page }) => [wrap(page)]);`,
      /can't follow the route builder "page" in wrap\(page\)/,
    ],
    [
      "a builder stored in an object",
      `const builders = { page };
export default defineRoutes(({ page }) => [builders.page("/admin", { component: () => null, guard: () => db.find("1") })]);`,
      /can't follow the route builder "page" in page,/,
    ],
    [
      "a builder handed on whole",
      `const build = (builder: any) => [builder.page("/admin", { component: () => null, guard: () => db.find("1") })];
export default defineRoutes((r) => build(r));`,
      /can't follow the route builder "r" in build\(r\)/,
    ],
    [
      "a definition object that spreads",
      `const hooks = { guard: () => db.find("1") };
export default defineRoutes([{ kind: "page", path: "/admin", component: () => null, ...hooks }]);`,
      /the \{ kind: "page" \} route definition spread another object/,
    ],
    [
      "a definition object whose kind is computed",
      `const kind = "page";
export default defineRoutes([{ kind, path: "/admin", component: () => null, guard: () => db.find("1") }]);`,
      /the route definition sets kind to an expression/,
    ],
    [
      "spread factory arguments",
      `const args = ["/admin", { component: () => null, guard: () => db.find("1") }] as const;
export default defineRoutes(({ page }) => [page(...args)]);`,
      /the page\(\) route options are spread in from a list/,
    ],
  ])("refuses %s", async (_name, routes, message) => {
    await expect(
      buildRoutes(
        `import { defineRoutes } from "@farm.js/core";
import { db } from "./db";
${routes}`,
        { ssr: false },
      ),
    ).rejects.toThrow(message);
  });

  it("leaves other members of the module namespace and shadowing locals alone", async () => {
    const output = await buildRoutes(
      `
import * as farm from "@farm.js/core";
import { page } from "@farm.js/core";
import { db } from "./db";
import { DocPage } from "./components";
function Pager({ items }: any) {
  const page = items.length;
  return <nav>{page} {String(farm.isNotFoundError)}</nav>;
}
export default farm.defineRoutes([
  page("/docs", { component: DocPage, pending: Pager, data: { main: () => db.find("1") } }),
]);
`,
      { ssr: false },
    );
    expect(output).not.toContain("DB_PASSWORD_SECRET");
    expect(output).toContain("CLIENT_COMPONENT_MARKER");
  });
});

describe("routes modules the client build can't read fully", () => {
  const ADMIN = `import { db } from "./db";
import { DocPage } from "./components";
`;
  const expectClean = (output: string) => {
    expect(output).not.toContain("DB_PASSWORD_SECRET");
    expect(output).not.toContain("PRIVATE_ROW_");
    expect(output).toContain("CLIENT_COMPONENT_MARKER");
  };

  it("strips a routes file whose only Farm import is a type", async () => {
    const output = await buildRoutes(
      `import type { ProgrammaticRouteDefinition } from "@farm.js/core";
${ADMIN}
export default [
  { kind: "page", path: "/admin", component: DocPage, guard: () => db.find("admin"), data: { main: () => db.find("1") } },
] satisfies ProgrammaticRouteDefinition[];`,
      { ssr: false, viaRouteModule: true },
    );
    expectClean(output);
    expect(output).toContain("__farmServerHooks");
  });

  it("strips a routes file that imports nothing from Farm", async () => {
    const output = await buildRoutes(
      `${ADMIN}
export default [
  { kind: "page", path: "/admin", component: DocPage, guard: () => db.find("admin") },
  { kind: "api", path: "/api/x", methods: { GET: () => db.find("2") } },
];`,
      { ssr: false, viaRouteModule: true },
    );
    expectClean(output);
    expect(output).toMatch(/methods: \{\}/);
  });

  it("strips a routes callback defineRoutes imports from another module", async () => {
    const output = await buildRoutes(
      `import { defineRoutes } from "@farm.js/core";
import build from "./routes-impl";
export default defineRoutes(build);`,
      {
        ssr: false,
        viaRouteModule: true,
        files: {
          "routes-impl.ts": `${ADMIN}
export default (r: any) => [r.page("/admin", { component: DocPage, guard: () => db.find("admin") })];`,
        },
      },
    );
    expectClean(output);
  });

  it("strips plain definitions a routes file takes from another module", async () => {
    const output = await buildRoutes(
      `import adminRoutes from "./admin-routes";
export default [...adminRoutes];`,
      {
        ssr: false,
        viaRouteModule: true,
        files: {
          "admin-routes.ts": `import type { ProgrammaticRouteDefinition } from "@farm.js/core";
${ADMIN}
export default [
  { kind: "page", path: "/admin", component: DocPage, data: { main: () => db.find("1") } },
] satisfies ProgrammaticRouteDefinition[];`,
        },
      },
    );
    expectClean(output);
  });

  it("keeps components declared in the routes file that pass data props", async () => {
    const output = await buildRoutes(
      `import { defineRoutes } from "@farm.js/core";
${ADMIN}
function Shell(props: any) {
  return <DocPage {...props} data={{ title: "shell" }} />;
}
export default defineRoutes(({ page }) => [
  page("/admin", {
    component: (props: any) => <Shell {...props} data={props.data} />,
    data: { main: () => db.find("1") },
  }),
]);`,
      { ssr: false, viaRouteModule: true },
    );
    expectClean(output);
  });

  it.each([
    [
      "a definition that spreads its kind",
      `const adminBase = { kind: "page", component: DocPage };
export default defineRoutes([{ ...adminBase, path: "/admin", guard: () => db.find("admin") }]);`,
      /still sets the server-only key "guard"/,
    ],
    [
      "a definition built with Object.assign",
      `export default defineRoutes([Object.assign({ kind: "page" }, { path: "/admin", component: DocPage, guard: () => db.find("admin") })]);`,
      /still sets the server-only key "guard"/,
    ],
    [
      "an escaping builder whose name a component parameter reuses",
      `export function Pager({ page }: any) { return page; }
const wrap = (factory: any) => factory;
export default defineRoutes([wrap(page)("/admin", { component: DocPage, guard: () => db.find("admin") })]);`,
      /can't follow the route builder "page" in wrap\(page\)/,
    ],
    [
      "an escaping builder whose name a callback parameter reuses",
      `const titles = ["a"].map((page) => page.toUpperCase());
const make = [page][0];
export default defineRoutes([make("/admin", { component: DocPage, data: { main: () => db.find(titles[0]) } })]);`,
      /can't follow the route builder "page" in \[page\]/,
    ],
    [
      "a computed builder member",
      `const member = "page";
export default defineRoutes([routesBuilder[member]("/admin", { component: DocPage, guard: () => db.find("admin") })]);`,
      /can't follow the route builder "routesBuilder"/,
    ],
  ])("refuses %s", async (_name, routes, message) => {
    const source = `import { defineRoutes, page, routesBuilder } from "@farm.js/core";
${ADMIN}${routes}`;
    for (const viaRouteModule of [false, true]) {
      await expect(buildRoutes(source, { ssr: false, viaRouteModule })).rejects.toThrow(message);
    }
  });

  it("strips a builder member named by a static template literal", async () => {
    const output = await buildRoutes(
      `import { defineRoutes, routesBuilder } from "@farm.js/core";
${ADMIN}export default defineRoutes([routesBuilder[\`page\`]("/admin", { component: DocPage, guard: () => db.find("admin") })]);`,
      { ssr: false },
    );
    expectClean(output);
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

async function buildRoutes(
  routes: string,
  options: {
    ssr: boolean;
    /** Load the routes file through a generated `?farm-route=` page module, as the app does. */
    viaRouteModule?: boolean;
    files?: Record<string, string>;
  },
): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "farm-routes-client-"));
  temporaryRoots.push(root);
  for (const [file, source] of Object.entries({ ...SERVER_FILES, ...options.files })) {
    writeFileSync(path.join(root, file), source);
  }
  // Outside src/, so only the generated route module marks it as the routes file.
  const routesFile = path.join(root, "farm.routes.tsx");
  writeFileSync(routesFile, routes);
  const routeModuleId = `${routesFile.replace(/\\/g, "/")}?farm-route=page:%2Fadmin&lang.js`;
  const entry = options.viaRouteModule ? routeModuleId : routesFile;

  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [
      {
        name: "test:farm-route-module",
        enforce: "pre",
        resolveId: (source) => (source === routeModuleId ? routeModuleId : null),
        load: (id) =>
          id === routeModuleId
            ? `import * as routes from ${JSON.stringify(routesFile)};\nexport default routes;`
            : null,
      },
      farmEnvironmentFunctionsPlugin(),
    ],
    build: {
      ssr: options.ssr,
      write: false,
      minify: false,
      target: "esnext",
      rollupOptions: {
        input: entry,
        external: ["@farm.js/core", "react", "react/jsx-runtime", "react/jsx-dev-runtime"],
        preserveEntrySignatures: "strict",
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];

  return outputs
    .flatMap((output) => (output as Rollup.RollupOutput).output)
    .filter((item): item is Rollup.OutputChunk => item.type === "chunk")
    .map((chunk) => chunk.code)
    .join("\n");
}
