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
  it("keeps guards, data, metadata, static paths, API handlers, and their imports out of the browser", async () => {
    const output = await buildRoutes(ROUTES, { ssr: false });

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
  });

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

async function buildRoutes(routes: string, options: { ssr: boolean }): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "farm-routes-client-"));
  temporaryRoots.push(root);
  for (const [file, source] of Object.entries(SERVER_FILES)) {
    writeFileSync(path.join(root, file), source);
  }
  const entry = path.join(root, "farm.routes.tsx");
  writeFileSync(entry, routes);

  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [farmEnvironmentFunctionsPlugin()],
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
