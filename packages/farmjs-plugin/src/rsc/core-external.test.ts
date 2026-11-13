import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import viteRsc from "@vitejs/plugin-rsc";
import { createBuilder } from "vite";
import { describe, expect, it } from "vitest";
import { resolveFarmAPIRequestURL } from "@farm.js/core/api";
import { resolveRscBuildOutputPath } from "./build-paths.js";
import farmRsc, { defineConfig } from "./index.js";
import { buildRscNitro } from "./nitro-build.js";
import { linkRscFixtureDependencies } from "./test-fixture-dependencies.js";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(2_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    // Bounded: Windows maps both signals to TerminateProcess, and waiting forever
    // for an exit event that has already fired turns a failure into a hung run.
    await Promise.race([once(child, "exit"), delay(5_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      throw new Error("Child process did not exit within 5s of SIGKILL");
    }
  }
}

describe("RSC core runtime bundling", () => {
  it("passes API configuration through the standalone config helper", () => {
    const api = { basePath: async () => "/backend" };
    expect((defineConfig({ api }) as any).api).toBe(api);
  });

  it.each(["serve", "build"] as const)(
    "resolves async API configuration once for the %s client and generated entry",
    async (command) => {
      const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-api-config-"));
      try {
        linkRscFixtureDependencies(root);
        const plugin = farmRsc().find(
          (candidate) => candidate.name === "@farm.js/plugin/rsc:config",
        );
        const configHook = plugin!.config as (
          config: Record<string, unknown>,
          env: { command: "serve" | "build"; mode: string },
        ) => Promise<any>;
        let calls = 0;
        const resolved = await configHook(
          {
            root,
            experimental: { serverComponents: true },
            api: {
              basePath: async ({ mode, root: apiRoot }: { mode: string; root: string }) => {
                calls++;
                expect(apiRoot).toBe(root);
                return `/${mode}-api`;
              },
            },
          },
          { command, mode: command === "build" ? "production" : "development" },
        );
        const basePath = command === "build" ? "/production-api" : "/development-api";
        expect(calls).toBe(1);
        expect(resolved.define.__FARM_API_BASE_URL__).toBe(JSON.stringify(basePath));
        expect(readFileSync(path.join(root, ".farm/rsc-entries/entry.rsc.tsx"), "utf8")).toContain(
          `const farmApiBasePath = ${JSON.stringify(basePath)};`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["Rolldown Vite", { rolldownVersion: "1.0.0" }, undefined],
    ["esbuild Vite", {}, { jsx: "automatic", jsxImportSource: "react" }],
  ])("sets esbuild JSX options only when needed (%s)", async (_name, meta, esbuild) => {
    const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-jsx-config-"));
    try {
      linkRscFixtureDependencies(root);
      const plugin = farmRsc().find((candidate) => candidate.name === "@farm.js/plugin/rsc:config");
      const configHook = plugin!.config as (
        this: { meta: Record<string, unknown> },
        config: Record<string, unknown>,
        env: { command: "serve"; mode: string },
      ) => Promise<any>;
      const resolved = await configHook.call(
        { meta },
        { root, experimental: { serverComponents: true } },
        { command: "serve", mode: "development" },
      );
      // oxc already uses the automatic runtime; esbuild options there only warn.
      expect(resolved.esbuild).toEqual(esbuild);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects mcp.oauth, which the RSC server cannot serve yet", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-mcp-oauth-"));
    try {
      linkRscFixtureDependencies(root);
      const plugin = farmRsc().find((candidate) => candidate.name === "@farm.js/plugin/rsc:config");
      const configHook = plugin!.config as (
        config: Record<string, unknown>,
        env: { command: "serve"; mode: string },
      ) => Promise<any>;
      await expect(
        configHook(
          {
            root,
            experimental: { serverComponents: true },
            mcp: { oauth: { authorizationServers: ["https://auth.example.com"] } },
          },
          { command: "serve", mode: "development" },
        ),
      ).rejects.toThrow("mcp.oauth is not supported in RSC apps yet");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not prefix absolute Vite environment output paths with the project root", () => {
    const root = path.resolve("/workspace/app");
    const absoluteOutDir = path.join(root, ".nitro", "vite", "dist", "rsc");

    // An absolute outDir is used as given, not resolved against the root again.
    expect(resolveRscBuildOutputPath(root, absoluteOutDir, "index.js")).toBe(
      path.join(absoluteOutDir, "index.js"),
    );
    expect(
      resolveRscBuildOutputPath(root, path.join(".nitro", "vite", "dist", "ssr"), "index.js"),
    ).toBe(path.join(root, ".nitro", "vite", "dist", "ssr", "index.js"));
  });

  it("rewrites root runtime imports to focused standalone subpaths", async () => {
    const plugin = farmRsc().find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:core-runtime",
    );

    expect(plugin?.apply).toBe("build");
    expect(typeof plugin?.transform).toBe("function");
    expect(typeof plugin?.resolveId).toBe("function");

    const transform = plugin?.transform as (
      code: string,
      id: string,
      options: { ssr?: boolean },
    ) => Promise<{ code: string } | null>;
    const transformed = await transform.call(
      { environment: { name: "rsc" } },
      `import {
        asString,
        createEndpoint,
        createRoute,
        defineWorkflow,
        getCurrentRequest,
        notFound,
        redirect,
        unstable_cache,
      } from "@farm.js/core";`,
      "/app/src/routes.ts",
      { ssr: false },
    );

    expect(transformed?.code).toContain('from "@farm.js/core/api"');
    expect(transformed?.code).toContain('from "@farm.js/core/routes"');
    expect(transformed?.code).toContain('from "@farm.js/core/request"');
    expect(transformed?.code).toContain('from "@farm.js/core/navigation"');
    expect(transformed?.code).toContain('from "@farm.js/core/cache"');
    expect(transformed?.code).toContain('from "@farm.js/core/query"');
    expect(transformed?.code).toContain('from "@farm.js/core/workflows"');
    expect(transformed?.code).not.toContain('from "@farm.js/core"');

    const resolveId = plugin?.resolveId as (
      id: string,
      importer: string | undefined,
      options: { ssr?: boolean },
    ) => unknown;
    expect(
      resolveId.call(
        { environment: { name: "ssr" } },
        "@farm.js/core/api/runtime",
        "/app/entry.rsc.tsx",
        { ssr: true },
      ),
    ).toBeNull();
    expect(
      resolveId.call({ environment: { name: "client" } }, "@farm.js/core", "/app/client.tsx", {
        ssr: false,
      }),
    ).toBeNull();
  });

  it("rewrites only the bounded core import after another named import", async () => {
    const plugin = farmRsc().find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:core-runtime",
    );
    const transform = plugin?.transform as (
      code: string,
      id: string,
      options: { ssr?: boolean },
    ) => Promise<{ code: string } | null>;
    const source = `import { z } from "zod";
import {
  redirect as go,
  type FarmConfig,
} from "@farm.js/core";

export const schema = z.string();`;

    const transformed = await transform.call(
      { environment: { name: "rsc" } },
      source,
      "/app/src/route.tsx",
      { ssr: false },
    );

    expect(transformed?.code).toContain('import { z } from "zod";');
    expect(transformed?.code.match(/from "zod"/g)).toHaveLength(1);
    expect(transformed?.code).toContain(
      'import { redirect as go } from "@farm.js/core/navigation";',
    );
    expect(transformed?.code).not.toContain('from "@farm.js/core"');
    expect(transformed?.code).toContain("export const schema = z.string();");
  });

  it("rejects storage imports that cannot run from isolated RSC output", async () => {
    const plugin = farmRsc().find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:core-runtime",
    );
    const transform = plugin?.transform as (
      code: string,
      id: string,
      options: { ssr?: boolean },
    ) => Promise<{ code: string } | null>;
    const context = { environment: { name: "rsc" } };

    await expect(
      transform.call(
        context,
        'import { memoryStorage } from "@farm.js/core";',
        "/app/src/storage.ts",
        { ssr: false },
      ),
    ).rejects.toThrow(/@farm.js\/core\/storage is not supported.*isolated server output/s);

    const resolveId = plugin?.resolveId as (
      id: string,
      importer: string | undefined,
      options: { ssr?: boolean },
    ) => unknown;
    expect(() =>
      resolveId.call(context, "@farm.js/core/storage", "/app/src/storage.ts", { ssr: false }),
    ).toThrow(/@farm.js\/core\/storage is not supported.*isolated server output/s);
  });

  it.each([
    { name: "default", api: undefined, baseURL: "/api", mount: "/api" },
    { name: "cache-variants", api: undefined, baseURL: "/api", mount: "/api" },
    { name: "config-middleware", api: undefined, baseURL: "/api", mount: "/api" },
    { name: "nested-layouts", api: undefined, baseURL: "/api", mount: "/api" },
    { name: "base-path", api: undefined, baseURL: "/api", mount: "/api" },
    { name: "i18n", api: undefined, baseURL: "/api", mount: "/api" },
    { name: "trailing-slash", api: undefined, baseURL: "/api", mount: "/api" },
    { name: "metadata-routes", api: undefined, baseURL: "/api", mount: "/api" },
    {
      name: "custom",
      api: {
        basePath: async ({ mode }: { mode: string }) =>
          mode === "production" ? "/backend" : "/dev-backend",
      },
      baseURL: "/backend",
      mount: "/backend",
    },
    { name: "root", api: { basePath: "/" }, baseURL: "/", mount: "" },
    {
      name: "external",
      api: { baseURL: "https://api.example.test/v1" },
      baseURL: "https://api.example.test/v1",
      mount: "/api",
    },
  ])(
    "builds and boots an isolated RSC app with the $name API root",
    async ({ name, api, baseURL, mount }) => {
      const fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-root-runtime-"));
      const isolatedRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-root-output-"));
      const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
      let child: ChildProcess | undefined;

      try {
        const srcDir = path.join(fixtureRoot, "src");
        mkdirSync(srcDir, { recursive: true });
        if (name === "default" || name === "custom") {
          const writeRoute = (file: string, source: string) => {
            const target = path.join(srcDir, file);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, source);
          };
          writeRoute(
            "broken/page.tsx",
            `export default async function Page() { throw new Error("private page failure"); }`,
          );
          writeRoute(
            "layout-failure/page.tsx",
            `export default function Page() { return <p>page</p>; }`,
          );
          writeRoute(
            "layout-failure/layout.tsx",
            `export default async function Layout() { throw new Error("private layout failure"); }`,
          );
          writeRoute(
            "sync-failure/page.tsx",
            `export default function Page() { throw new Error("private sync failure"); }`,
          );
          writeRoute(
            "middleware.ts",
            `export function middleware(request, context) {
            if (new URL(request.url).pathname === "/middleware-failure") throw new Error("private middleware failure");
            context.headers.set("cache-control", "public, max-age=60");
          }`,
          );
          writeRoute(
            "go/page.tsx",
            `import { redirect } from "@farm.js/core/navigation"; export default async function Page() { redirect("/", 307); }`,
          );
          writeRoute(
            "missing/page.tsx",
            `import { notFound } from "@farm.js/core/navigation"; export default async function Page() { notFound(); }`,
          );
          if (name === "default") {
            writeRoute(
              "accounts/[id]/page.tsx",
              `export default async function Page() { throw new Error("private dynamic account failure"); }`,
            );
            writeRoute(
              "accounts/[id]/error.tsx",
              `"use client"; export default function ErrorPage() { return <main>Dynamic account error rendered</main>; }`,
            );
            writeRoute(
              "accounts/new/page.tsx",
              `export default async function Page() { throw new Error("private static account failure"); }`,
            );
            for (const [folder, marker] of [
              ["(shop)/products", "Grouped product error rendered"],
              ["docs/[[...slug]]", "Optional docs error rendered"],
              ["middleware-failure", "Unselected page error rendered"],
            ]) {
              writeRoute(
                `${folder}/page.tsx`,
                `export default async function Page() { throw new Error("private boundary ancestry failure"); }`,
              );
              writeRoute(
                `${folder}/error.tsx`,
                `"use client"; export default function ErrorPage() { return <main>${marker}</main>; }`,
              );
            }
            writeRoute(
              "users/[id]/page.tsx",
              `export default function Page({ params }) { return <main>Dynamic user {params.id}</main>; }`,
            );
            writeRoute(
              "users/new/page.tsx",
              `export default function Page() { return <main>Static new user</main>; }`,
            );
            writeRoute(
              "optional/[[...slug]]/page.tsx",
              `export default function Page({ params }) { return <main>Optional catch-all {JSON.stringify(params)}</main>; }`,
            );
            writeRoute(
              "(marketing)/pricing/page.tsx",
              `export default function Page() { return <p>Grouped pricing</p>; }`,
            );
            writeRoute(
              "error.tsx",
              `"use client"; export default function ErrorPage({ error, reset, path, searchParams }) {
              return <main>Route error rendered <p>{error.message}</p><p>{path}</p><p>{JSON.stringify(searchParams)}</p><button onClick={reset}>Reset</button></main>;
            }`,
            );
            writeRoute(
              "hook-control/page.tsx",
              `import { useId } from "react"; export default function Page() { const id = useId(); return <main id={id}>Hook control</main>; }`,
            );
            writeRoute(
              "hook-sniff/page.tsx",
              `import { useId } from "react"; export default function Page() { const label = "async is just text"; const id = useId(); return <main id={id}>Hook scan {label}</main>; }`,
            );
            writeRoute(
              "hook-layout/layout.tsx",
              `import { useId } from "react"; export default function Layout({ children }) { const id = useId(); const label = "async is just text"; return <section id={id}>Hook layout {label} {children}</section>; }`,
            );
            writeRoute(
              "hook-layout/page.tsx",
              `export default function Page() { return <main>Hook layout page</main>; }`,
            );
            writeRoute(
              "async-layout/[id]/layout.tsx",
              `export default async function Layout({ children }) { await Promise.resolve(); return <aside>Async layout {children}</aside>; }`,
            );
            writeRoute(
              "async-layout/[id]/page.tsx",
              `export default async function Page({ params }) { await Promise.resolve(); return <p>Async page {params.id}</p>; }`,
            );
            writeRoute(
              "bad-boundary/page.tsx",
              `export default async function Page() { throw new Error("private original failure"); }`,
            );
            writeRoute(
              "bad-boundary/error.tsx",
              `"use client"; export default function ErrorPage() { throw new Error("private boundary failure"); }`,
            );
            writeRoute(
              "server-boundary/page.tsx",
              `export default async function Page() { throw new Error("private server failure"); }`,
            );
            writeRoute(
              "server-boundary/error.tsx",
              `export default function ErrorPage({ error }) { return <main>Server error rendered {error.message}</main>; }`,
            );
          }
        }
        writeFileSync(
          path.join(fixtureRoot, "package.json"),
          JSON.stringify({
            name: "farm-rsc-root-runtime-fixture",
            private: true,
            type: "module",
          }),
        );
        if (name === "config-middleware") {
          writeFileSync(
            path.join(fixtureRoot, "middleware-config.ts"),
            `export const middlewareHeaderName = "x-config-middleware";
export function shouldRunConfigMiddleware(context) {
  return context.request.headers.get("x-run-config-middleware") === "yes";
}`,
          );
          writeFileSync(
            path.join(fixtureRoot, "farm.config.ts"),
            `import { defineConfig } from "@farm.js/core";
import farmRsc from "@farm.js/plugin/rsc";
import { middlewareHeaderName, shouldRunConfigMiddleware } from "./middleware-config";
const middlewareHeaderValue = "active";
export default defineConfig({
  plugins: [farmRsc()],
  middleware: [
    { matcher: /^\\/$/ },
    {
      matcher: shouldRunConfigMiddleware,
      handler(context) {
        context.headers.set(middlewareHeaderName, middlewareHeaderValue);
      },
    },
  ],
});`,
          );
        }
        if (name === "cache-variants") {
          writeFileSync(
            path.join(srcDir, "middleware.ts"),
            // Only sets headers, so it opts back into shared caching.
            `export const config = { cache: "public" };
          export function middleware(request, context) {
            context.headers.set("cache-control", "public, max-age=60");
            context.headers.set("vary", new URL(request.url).searchParams.has("wildcard") ? "*" : "Origin, aCcEpT");
          }`,
          );
        }
        const fixtureModules = path.join(fixtureRoot, "node_modules");
        if (name === "nested-layouts") {
          const writeRoute = (file: string, source: string) => {
            const target = path.join(srcDir, file);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, source);
          };
          writeRoute(
            "nested/layout.tsx",
            `import { useId } from "react"; export default function Layout({ children }) { const id = useId(); return <section id={id}>Nested layout {children}</section>; }`,
          );
          writeRoute(
            "nested/page.tsx",
            `export default function Page() { return <main>Nested page</main>; }`,
          );
          writeRoute(
            "components/provider.tsx",
            `"use client";
            import { createContext, useContext } from "react";
            const Context = createContext("missing provider");
            export function Provider({ children }) { return <Context.Provider value="root provider present">{children}</Context.Provider>; }
            export function Consumer() { return <p>{useContext(Context)}</p>; }
          `,
          );
          writeRoute(
            "nested/client/page.tsx",
            `"use client";
            import { useState } from "react"; import { Consumer } from "../../components/provider";
            export default function Page() { const [count, setCount] = useState(0); return <main>Client page<Consumer /><button onClick={() => setCount(count + 1)}>Count {count}</button></main>; }
          `,
          );
          writeRoute(
            "async-layout/[id]/layout.tsx",
            `export default async function Layout({ children, params }) { await Promise.resolve(); return <aside>Async layout {params.id} {children}</aside>; }`,
          );
          writeRoute(
            "async-layout/[id]/page.tsx",
            `export default async function Page() { await Promise.resolve(); return <p>Async page</p>; }`,
          );
        }
        if (name === "trailing-slash") {
          // basePath "/console" with trailingSlash: pages answer at '/console/about/', a <Link>
          // renders that URL, and a static page prerenders there.
          const writeRoute = (file: string, source: string) => {
            const target = path.join(srcDir, file);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, source);
          };
          writeRoute(
            "about/page.tsx",
            `export default function Page() { return <main>About with a trailing slash</main>; }`,
          );
          writeRoute(
            "static/page.tsx",
            `export const dynamic = "force-static";
export default function Page() { return <main>Static with a trailing slash</main>; }`,
          );
          writeRoute(
            "links/page.tsx",
            `import { Link } from "@farm.js/core/client";
export default function Page() { return <Link href="/about">About link</Link>; }`,
          );
        }
        if (name === "metadata-routes") {
          // basePath "/console" with sitemap.ts, robots.ts, llms.ts and llms-full.ts route files,
          // which replace the generated files as in core, and a nested dynamic sitemap.ts.
          const writeRoute = (file: string, source: string) => {
            const target = path.join(srcDir, file);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, source);
          };
          writeRoute(
            "about/page.tsx",
            `export const metadata = { title: "About" };
export default function Page() { return <main>About from a route file app</main>; }`,
          );
          writeRoute(
            "sitemap.ts",
            `export const revalidate = 60;
export default function sitemap({ path }) {
  return [{ url: "https://shop.example/console/custom", lastModified: "2026-01-02" }, { url: "https://shop.example/at" + path }];
}`,
          );
          writeRoute(
            "docs/[section]/sitemap.ts",
            `export default function sitemap({ params, path }) {
  return [{ url: "https://shop.example/console" + path + "?section=" + params.section }];
}`,
          );
          writeRoute(
            "robots.ts",
            `export default function robots() { return { rules: { userAgent: "*", disallow: "/private" } }; }`,
          );
          writeRoute(
            "llms.ts",
            `export default function llms({ pages, defaults }) {
  return { ...defaults, title: "Custom index", details: "Paths: " + pages.map((page) => page.path).join(", ") };
}`,
          );
          writeRoute(
            "llms-full.ts",
            `export default function llmsFull({ defaults }) { return { ...defaults, title: "Custom full" }; }`,
          );
        }
        if (name === "base-path") {
          // basePath "/console": a page at its route path, one nested under app/console/ as RSC
          // apps had to before, and a <Link> that core renders below the basePath.
          const writeRoute = (file: string, source: string) => {
            const target = path.join(srcDir, file);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, source);
          };
          writeRoute(
            "about/page.tsx",
            `export default function Page() { return <main>About below the basePath</main>; }`,
          );
          writeRoute(
            "console/legacy/page.tsx",
            `export default function Page() { return <main>Nested under the basePath</main>; }`,
          );
          writeRoute(
            "links/page.tsx",
            `import { Link } from "@farm.js/core/client";
export default function Page() { return <Link href="/about">About link</Link>; }`,
          );
        }
        if (name === "i18n") {
          // basePath "/console" with en and fr: pages read the request locale from core's runtime,
          // whether they answer at their route path or under a [lang] folder.
          const writeRoute = (file: string, source: string) => {
            const target = path.join(srcDir, file);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, source);
          };
          writeRoute("messages/en.json", JSON.stringify({ greeting: "Hello" }));
          writeRoute("messages/fr.json", JSON.stringify({ greeting: "Bonjour" }));
          writeRoute(
            "about/page.tsx",
            `import { getLocale, getLocaleSource, t } from "@farm.js/core/i18n/server";
export default function Page() { return <main>{"Locale " + getLocale() + " from " + getLocaleSource() + ": " + t("greeting")}</main>; }`,
          );
          writeRoute(
            "console/[lang]/legacy/page.tsx",
            `import { getLocale } from "@farm.js/core/i18n/server";
export default function Page({ params }) { return <main>{"Legacy " + params.lang + " in " + getLocale()}</main>; }`,
          );
          writeRoute(
            "components/greeting.tsx",
            `"use client";
import { useLocale, useTranslations } from "@farm.js/core/i18n/client";
export function Greeting() { const t = useTranslations(); return <p>{"Client " + useLocale().locale + ": " + t("greeting")}</p>; }`,
          );
          writeRoute(
            "links/page.tsx",
            `import { Link } from "@farm.js/core/client";
import { Greeting } from "../components/greeting";
export default function Page() { return <><Link href="/about">About link</Link><Greeting /></>; }`,
          );
          writeRoute(
            "static/page.tsx",
            `import { getLocale } from "@farm.js/core/i18n/server";
export const dynamic = "force-static";
export default function Page() { return <main>{"Static " + getLocale()}</main>; }`,
          );
          writeRoute(
            "go/page.tsx",
            `import { redirect } from "@farm.js/core/navigation";
export default async function Page() { redirect("/about"); }`,
          );
          writeRoute(
            "form/actions.ts",
            `"use server";
import { redirect } from "@farm.js/core/navigation";
export async function goAbout() { redirect("/about"); }`,
          );
          writeRoute(
            "form/page.tsx",
            `import { goAbout } from "./actions";
export default function Page() { return <form action={goAbout}><button type="submit">Go</button></form>; }`,
          );
          writeRoute(
            "api/locale/route.ts",
            `import { getLocale, getLocaleSource } from "@farm.js/core/i18n/server";
export function GET() { return Response.json({ locale: getLocale(), source: getLocaleSource() }); }`,
          );
        }
        for (const packageName of [
          "@farm.js/core",
          "@vitejs/plugin-rsc",
          "better-call",
          "react",
          "react-dom",
          "react-server-dom-webpack",
          "rsc-html-stream",
          "vite",
        ]) {
          const linkPath = path.join(fixtureModules, packageName);
          const packagePath = [
            path.join(packageRoot, "node_modules", packageName),
            path.resolve(packageRoot, "../../examples/rsc-demo/node_modules", packageName),
          ].find((candidate) => existsSync(candidate));
          if (!packagePath) throw new Error(`Missing fixture dependency: ${packageName}`);
          mkdirSync(path.dirname(linkPath), { recursive: true });
          symlinkSync(
            realpathSync(packagePath),
            linkPath,
            process.platform === "win32" ? "junction" : "dir",
          );
        }
        writeFileSync(
          path.join(srcDir, "layout.tsx"),
          `${name === "nested-layouts" ? 'import { Provider } from "./components/provider";' : ""}
export default function Layout({ children }) {
  return ${name === "nested-layouts" ? "<section>Root layout marker <Provider>{children}</Provider></section>" : name === "i18n" ? "<section>{children}</section>" : "<html><body>{children}</body></html>"};
}`,
        );
        writeFileSync(
          path.join(srcDir, "page.tsx"),
          `export default function Page() {
  return <main>RSC root runtime fixture</main>;
}`,
        );
        writeFileSync(
          path.join(srcDir, "routes.ts"),
          `import {
  createEndpoint,
  createRoute,
  getCurrentRequest,
  headers,
  isFarmNotFoundError,
  isFarmRedirectError,
  notFound,
  redirect,
  unstable_cache,
  asString,
  defineWorkflow,
} from "@farm.js/core";

const representativeRoute = createRoute("/root-public-api", {
  component: () => null,
});
const cachedMarker = unstable_cache(
  async () => "root-cache-ok",
  ["rsc-root-runtime-fixture"],
);
const workflow = defineWorkflow({
  id: "root-runtime-workflow",
  run: async () => "workflow-ok",
});

function recognizesRedirect() {
  try {
    redirect("/root-target");
  } catch (error) {
    return isFarmRedirectError(error);
  }
  return false;
}

function recognizesNotFound() {
  try {
    notFound();
  } catch (error) {
    return isFarmNotFoundError(error);
  }
  return false;
}

export const rootRuntime = createEndpoint("/api/root-runtime", {
  method: "GET",
}, async () => {
  return {
    runtime: "bundled-root-facade",
    marker: headers().get("x-root-runtime"),
    requestPath: new URL(getCurrentRequest().url).pathname,
    route: { kind: representativeRoute.kind, path: representativeRoute.path },
    cache: await cachedMarker(),
    query: asString.parse("  query-ok  "),
    workflow: { id: workflow.id, kind: workflow.kind },
    redirect: recognizesRedirect(),
    notFound: recognizesNotFound(),
  };
});

export const echo = createEndpoint("/api/echo", { method: "POST" }, async ({ body }) => ({ body }));
`,
        );

        const plugins = farmRsc({ routesDir: "" }).filter(
          (plugin) => plugin.name !== "@farm.js/plugin/rsc:nitro-build",
        );
        plugins.push(
          ...viteRsc({
            serverHandler: false,
            entries: {
              rsc: "./.farm/rsc-entries/entry.rsc.tsx",
              ssr: "./.farm/rsc-entries/entry.ssr.tsx",
              client: "./.farm/rsc-entries/entry.browser.tsx",
            },
          }),
        );

        const builder = await createBuilder({
          root: fixtureRoot,
          configFile: false,
          logLevel: "silent",
          srcDir: "src",
          outDir: "dist",
          esbuild: { jsxDev: false },
          experimental: { serverComponents: true, serverActions: true },
          ...(name === "base-path" ? { basePath: "/console" } : {}),
          ...(name === "i18n"
            ? { basePath: "/console", i18n: { locales: ["en", "fr"], defaultLocale: "en" } }
            : {}),
          ...(name === "metadata-routes"
            ? { basePath: "/console", agent: { crawlers: true, llmsTxt: true } }
            : {}),
          ...(name === "trailing-slash"
            ? {
                basePath: "/console",
                trailingSlash: true,
                agent: { crawlers: { training: "block" } },
              }
            : {}),
          api,
          middleware: name === "config-middleware" ? { matcher: "/", handler() {} } : undefined,
          plugins,
        } as never);
        expect(builder.config.define?.__FARM_API_BASE_URL__).toBe(JSON.stringify(baseURL));
        await builder.buildApp();

        const rscPath = path.join(fixtureRoot, "dist", "rsc", "index.js");
        const ssrPath = path.join(fixtureRoot, "dist", "ssr", "index.js");
        const clientDir = path.join(fixtureRoot, "dist", "client");
        const rscCode = readFileSync(rscPath, "utf-8");
        expect(rscCode).not.toMatch(/from\s*["']@farm.js\/core["']/);
        if (name === "config-middleware") {
          expect(rscCode).not.toContain("@farm.js/plugin/rsc");
        }

        const outputDir = path.join(fixtureRoot, ".output");
        await buildRscNitro({
          root: fixtureRoot,
          rendererPath: rscPath,
          ssrPath,
          publicDir: clientDir,
          outputDir,
          preset: "node-server",
        });

        const outputPackage = JSON.parse(
          readFileSync(path.join(outputDir, "server", "package.json"), "utf-8"),
        ) as { dependencies?: Record<string, string> };
        expect(outputPackage.dependencies).not.toHaveProperty("@farm.js/core");
        expect(outputPackage.dependencies).not.toHaveProperty("@farm.js/plugin");
        for (const buildOnlyPackage of ["vite", "nitro", "rollup", "rolldown", "esbuild"]) {
          expect(outputPackage.dependencies).not.toHaveProperty(buildOnlyPackage);
          expect(existsSync(path.join(outputDir, "server", "node_modules", buildOnlyPackage))).toBe(
            false,
          );
        }
        expect(existsSync(path.join(outputDir, "server", "node_modules", "@farm.js", "core"))).toBe(
          false,
        );

        if (name === "i18n") {
          // A static page prerenders at the URL that names its locale. The default locale's URL
          // redirects visitors who prefer French, so it stays server-rendered.
          const publicDir = path.join(outputDir, "public", "console");
          expect(
            readFileSync(path.join(publicDir, "fr", "static", "index.html"), "utf8"),
          ).toContain("Static fr");
          expect(readFileSync(path.join(publicDir, "fr", "static.rsc"), "utf8")).toContain(
            "Static fr",
          );
          expect(existsSync(path.join(publicDir, "static", "index.html"))).toBe(false);
        }

        const isolatedOutput = path.join(isolatedRoot, ".output");
        cpSync(outputDir, isolatedOutput, { recursive: true });
        rmSync(fixtureRoot, { recursive: true, force: true });

        const port = await availablePort();
        let logs = "";
        child = spawn(process.execPath, [path.join(isolatedOutput, "server", "index.mjs")], {
          cwd: isolatedRoot,
          env: {
            ...process.env,
            HOST: "127.0.0.1",
            PORT: String(port),
            NODE_ENV: "production",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout?.on("data", (chunk) => {
          logs += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
          logs += chunk.toString();
        });

        let response: Response | undefined;
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline && child.exitCode === null) {
          try {
            response = await fetch(`http://127.0.0.1:${port}/api/root-runtime`, {
              headers: { "x-root-runtime": "isolated" },
            });
            break;
          } catch {
            await delay(50);
          }
        }

        expect(response, logs).toBeDefined();
        expect(response?.status, logs).toBe(200);
        await expect(response?.json()).resolves.toEqual({
          runtime: "bundled-root-facade",
          marker: "isolated",
          requestPath: "/api/root-runtime",
          route: { kind: "page", path: "/root-public-api" },
          cache: "root-cache-ok",
          query: "query-ok",
          workflow: { id: "root-runtime-workflow", kind: "farm-workflow" },
          redirect: true,
          notFound: true,
        });

        const origin = `http://127.0.0.1:${port}`;
        if (name === "config-middleware") {
          const skipped = await fetch(origin + "/");
          expect(skipped.status, logs).toBe(200);
          expect(skipped.headers.get("x-config-middleware")).toBeNull();

          const handled = await fetch(origin + "/", {
            headers: { "x-run-config-middleware": "yes" },
          });
          expect(handled.status, logs).toBe(200);
          expect(handled.headers.get("x-config-middleware")).toBe("active");
        }
        if (name === "default") {
          for (const [pathname, expected, excluded] of [
            ["/accounts/new", "Route error rendered", "Dynamic account error rendered"],
            ["/accounts/alice", "Dynamic account error rendered", "Route error rendered"],
            ["/products", "Grouped product error rendered", "Route error rendered"],
            ["/docs", "Optional docs error rendered", "Route error rendered"],
            ["/docs/a/b", "Optional docs error rendered", "Route error rendered"],
            ["/middleware-failure", "Route error rendered", "Unselected page error rendered"],
          ]) {
            for (const accept of ["text/html", "text/x-component"]) {
              const response = await fetch(origin + pathname, {
                headers: { accept },
                signal: AbortSignal.timeout(10_000),
              });
              const body = await response.text();
              expect(response.status, logs).toBe(500);
              expect(response.headers.get("content-type")).toContain(accept);
              expect(response.headers.get("cache-control")).toBe("private, no-store");
              expect(body).not.toContain("private ");
              // Flight contains client module references; HTML contains rendered fallback UI.
              if (accept === "text/html") {
                expect(body, logs).toContain(expected);
                expect(body, logs).not.toContain(excluded);
              }
            }
          }
          for (const uploadCase of [
            {
              path: "/api/echo",
              headers: { "content-length": "10000001", "content-type": "application/octet-stream" },
              body: Buffer.from("abc"),
            },
            {
              path: "/",
              headers: { "x-farm-action-id": "unresolved-action", "content-type": "text/plain" },
              body: Buffer.alloc(1_000_001, 120),
            },
          ]) {
            const uploadResult = await new Promise<{ status: number; outcome: string }>(
              (resolve) => {
                const upload = httpRequest(
                  origin + uploadCase.path,
                  { method: "POST", headers: { ...uploadCase.headers, origin } },
                  (response) => {
                    response.resume();
                    resolve({ status: response.statusCode || 0, outcome: "response" });
                    upload.destroy();
                  },
                );
                upload.on("error", (error) => resolve({ status: 0, outcome: error.message }));
                upload.setTimeout(10_000, () => {
                  resolve({ status: 0, outcome: "timed out without response" });
                  upload.destroy();
                });
                upload.write(uploadCase.body);
                // Leave the upload open: either the declared or streamed limit is exceeded.
              },
            );
            expect(
              uploadResult,
              `Oversized upload to ${uploadCase.path} should receive 413 before the client finishes sending`,
            ).toEqual({ status: 413, outcome: "response" });
          }
        }
        if (name === "default" || name === "custom") {
          for (const route of ["broken", "layout-failure", "sync-failure", "middleware-failure"]) {
            const error = await fetch(origin + "/" + route + "?tag=a&tag=b", {
              signal: AbortSignal.timeout(10_000),
            });
            const body = await error.text();
            expect(error.status, logs).toBe(500);
            expect(error.headers.get("cache-control")).toBe("private, no-store");
            expect(body).not.toContain("private page failure");
            expect(body).not.toContain("private layout failure");
            expect(body).not.toContain("private sync failure");
            expect(body).not.toContain("private middleware failure");
            if (name === "default") {
              expect(error.headers.get("content-type")).toContain("text/html");
              expect(body, logs).toContain("Route error rendered");
              expect(body).toContain("Internal Server Error");
              expect(body).toContain("Reset");
              expect(body).toContain("/" + route);
              expect(body).toContain("&quot;tag&quot;:[&quot;a&quot;,&quot;b&quot;]");
            } else {
              expect(JSON.parse(body).message).toBe("Internal Server Error");
            }
          }
          expect(logs).not.toContain("glob is not defined");
          expect(logs).toContain("private page failure");
          const go = await fetch(origin + "/go", { redirect: "manual" });
          expect(go.status).toBe(307);
          expect(go.headers.get("location")).toBe("/");
          expect((await fetch(origin + "/missing")).status).toBe(404);
          const postFailure = await fetch(origin + "/middleware-failure", {
            method: "POST",
            headers: { origin },
            body: "x",
          });
          expect(postFailure.status).toBe(500);
          expect(await postFailure.text()).toBe("Server function failed");
          if (name === "default") {
            const flight = await fetch(origin + "/broken", {
              headers: { accept: "text/x-component" },
              signal: AbortSignal.timeout(10_000),
            });
            expect(flight.status).toBe(500);
            expect(flight.headers.get("content-type")).toContain("text/x-component");
            const body = await flight.text();
            expect(body).toContain("rootContent");
            expect(body).not.toContain("private page failure");
            const serverBoundary = await fetch(origin + "/server-boundary", {
              signal: AbortSignal.timeout(10_000),
            });
            expect(serverBoundary.status).toBe(500);
            expect(await serverBoundary.text(), logs).toContain("Server error rendered");
            const badBoundary = await fetch(origin + "/bad-boundary", {
              signal: AbortSignal.timeout(10_000),
            });
            expect(badBoundary.status).toBe(500);
            expect(await badBoundary.json()).toMatchObject({ message: "Internal Server Error" });
          }
        }
        const aliasedResponse = await fetch(`${origin}${mount}/root-runtime`);
        expect(aliasedResponse.status, logs).toBe(200);
        expect((await aliasedResponse.json()).requestPath).toBe(`${mount}/root-runtime`);
        if (name === "default") {
          for (const [pathname, marker] of [
            ["/users/new", "Static new user"],
            ["/users/alice", "Dynamic user"],
            ["/optional", "Optional catch-all"],
            ["/optional/a/b", "Optional catch-all"],
            ["/pricing", "Grouped pricing"],
          ]) {
            for (const accept of ["text/html", "text/x-component"]) {
              const response = await fetch(origin + pathname, {
                headers: { accept },
                signal: AbortSignal.timeout(10_000),
              });
              expect(response.status, logs).toBe(200);
              expect(await response.text(), logs).toContain(marker);
            }
          }
        }

        if (name === "cache-variants") {
          for (const accept of ["text/html", "text/x-component"]) {
            const page = await fetch(origin + "/", {
              headers: { accept },
              signal: AbortSignal.timeout(10_000),
            });
            expect(page.status, logs).toBe(200);
            expect(page.headers.get("content-type")).toContain(accept);
            expect(await page.text(), logs).toContain("RSC root runtime fixture");
            expect(page.headers.get("cache-control")).toBe("public, max-age=60");
            const fields = page.headers.get("vary")?.toLowerCase().split(/,\s*/);
            // Nitro only adds Accept-Encoding when it actually negotiates a
            // compressed representation; these are the app-owned variants.
            expect(fields).toEqual(expect.arrayContaining(["accept", "origin"]));
            expect(fields?.filter((value) => value === "accept")).toHaveLength(1);
            const wildcard = await fetch(origin + "/?wildcard", {
              headers: { accept },
              signal: AbortSignal.timeout(10_000),
            });
            expect(await wildcard.text(), logs).toContain("RSC root runtime fixture");
            expect(wildcard.headers.get("vary")).toBe("*");
          }
        }
        if (name === "nested-layouts") {
          for (const [pathname, markers] of [
            ["/", ["Root layout marker"]],
            ["/nested", ["Root layout marker", "Nested layout", "Nested page"]],
            ["/async-layout/42", ["Root layout marker", "Async layout", "42", "Async page"]],
          ] as const) {
            for (const accept of ["text/html", "text/x-component"]) {
              const response = await fetch(origin + pathname, {
                headers: { accept },
                signal: AbortSignal.timeout(10_000),
              });
              expect(response.status, logs).toBe(200);
              const body = await response.text();
              for (const marker of markers) expect(body, logs).toContain(marker);
            }
          }
          const client = await fetch(origin + "/nested/client", {
            signal: AbortSignal.timeout(10_000),
          });
          expect(client.status, logs).toBe(200);
          const body = await client.text();
          for (const marker of [
            "Root layout marker",
            "Nested layout",
            "root provider present",
            "Client page",
          ]) {
            expect(body, logs).toContain(marker);
          }
        }
        if (name === "base-path") {
          for (const [pathname, accept, marker] of [
            ["/console", "text/html", "RSC root runtime fixture"],
            ["/console/about", "text/html", "About below the basePath"],
            ["/console/about", "text/x-component", "About below the basePath"],
            // Client navigation requests '<page>.rsc'.
            ["/console/about.rsc", "*/*", "About below the basePath"],
            ["/console/legacy", "text/html", "Nested under the basePath"],
            ["/console/legacy.rsc", "*/*", "Nested under the basePath"],
            ["/console/links", "text/html", 'href="/console/about"'],
            // Core's renderers answer without the basePath too.
            ["/about", "text/html", "About below the basePath"],
          ] as const) {
            const response = await fetch(origin + pathname, {
              headers: { accept },
              signal: AbortSignal.timeout(10_000),
            });
            expect(response.status, `${pathname} ${logs}`).toBe(200);
            expect(await response.text(), pathname).toContain(marker);
          }
          expect((await fetch(origin + "/console/missing")).status).toBe(404);
          // Without trailingSlash, a page's trailing-slash URL redirects to the one without.
          for (const [pathname, location] of [
            ["/console/about/?tab=1", "/console/about?tab=1"],
            ["/console/", "/console"],
            ["/console/about/index.rsc", "/console/about.rsc"],
          ]) {
            const response = await fetch(origin + pathname, { redirect: "manual" });
            expect(response.status, `${pathname} ${logs}`).toBe(308);
            expect(response.headers.get("location"), pathname).toBe(location);
          }
          // llms.txt answers below the basePath and lists each page's public Markdown URL.
          const llms = await fetch(origin + "/console/llms.txt");
          expect(llms.status, logs).toBe(200);
          const llmsBody = await llms.text();
          for (const url of ["/console/index.md", "/console/about.md", "/console/legacy.md"]) {
            expect(llmsBody, url).toContain(`(${origin}${url})`);
          }
          expect(llmsBody).not.toContain("/console/console");
          // So does sitemap.xml, on by default as in core, with each page's lastmod.
          const sitemap = await fetch(origin + "/console/sitemap.xml");
          expect(sitemap.status, logs).toBe(200);
          const sitemapBody = await sitemap.text();
          // Each at the URL it answers at: '/console/' redirects to '/console'.
          for (const url of ["/console", "/console/about", "/console/legacy"]) {
            expect(sitemapBody, url).toContain(`<loc>${origin}${url}</loc>`);
          }
          expect(sitemapBody).toContain("<lastmod>");
          expect(sitemapBody).not.toContain("/console/console");
          // The head advertises each page's Markdown mirror, as the Link header does.
          for (const [pathname, mirror] of [
            ["/console", "/console/index.md"],
            ["/console/about", "/console/about.md"],
            ["/console/legacy", "/console/legacy.md"],
          ]) {
            const html = await (await fetch(origin + pathname)).text();
            expect(html, pathname).toContain(
              `<link rel="alternate" href="${mirror}" type="text/markdown">`,
            );
          }
        }
        if (name === "trailing-slash") {
          for (const [pathname, accept, marker] of [
            ["/console/", "text/html", "RSC root runtime fixture"],
            ["/console/about/", "text/html", "About with a trailing slash"],
            ["/console/about/", "text/x-component", "About with a trailing slash"],
            ["/console/about/index.rsc", "*/*", "About with a trailing slash"],
            ["/console/links/", "text/html", 'href="/console/about/"'],
            ["/console/static/", "text/html", "Static with a trailing slash"],
            ["/console/static/index.rsc", "*/*", "Static with a trailing slash"],
          ] as const) {
            const response = await fetch(origin + pathname, {
              headers: { accept },
              redirect: "manual",
              signal: AbortSignal.timeout(10_000),
            });
            expect(response.status, `${pathname} ${logs}`).toBe(200);
            expect(await response.text(), pathname).toContain(marker);
          }
          for (const [pathname, location] of [
            ["/console/about?tab=1", "/console/about/?tab=1"],
            ["/console", "/console/"],
            // A navigation's payload request goes to the canonical page's payload.
            ["/console/about.rsc", "/console/about/index.rsc"],
          ]) {
            const response = await fetch(origin + pathname, { redirect: "manual" });
            expect(response.status, `${pathname} ${logs}`).toBe(308);
            expect(response.headers.get("location"), pathname).toBe(location);
          }
          // sitemap.xml lists each page at the URL it answers at, so none of them redirects.
          const sitemapBody = await (await fetch(origin + "/console/sitemap.xml")).text();
          const listed = [...sitemapBody.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
          for (const url of ["/console/", "/console/about/", "/console/static/"]) {
            expect(listed, url).toContain(origin + url);
            const response = await fetch(origin + url, { redirect: "manual" });
            expect(response.status, `${url} ${logs}`).toBe(200);
          }
          expect(listed.filter((url) => !url.endsWith("/"))).toEqual([]);
          // agent.crawlers serves a generated robots.txt below the basePath, as in core.
          const robots = await fetch(origin + "/console/robots.txt");
          expect(robots.status, logs).toBe(200);
          expect(await robots.text()).toMatch(/User-agent: GPTBot\n[\s\S]*Disallow: \//);
          // The static page and its payload were written at the trailing-slash URL.
          for (const file of ["index.html", "index.rsc"]) {
            expect(
              existsSync(path.join(isolatedOutput, "public", "console", "static", file)),
              file,
            ).toBe(true);
          }
        }
        if (name === "metadata-routes") {
          const get = (pathname: string) =>
            fetch(origin + pathname, { signal: AbortSignal.timeout(10_000) });
          // sitemap.ts replaces the generated sitemap, below the basePath and at the origin root.
          for (const pathname of ["/console/sitemap.xml", "/sitemap.xml"]) {
            const sitemap = await get(pathname);
            expect(sitemap.status, `${pathname} ${logs}`).toBe(200);
            expect(sitemap.headers.get("content-type")).toBe("application/xml; charset=utf-8");
            expect(sitemap.headers.get("cache-control")).toContain("s-maxage=60");
            const xml = await sitemap.text();
            expect(xml).toContain("<loc>https://shop.example/console/custom</loc>");
            expect(xml).toContain("<loc>https://shop.example/at/</loc>");
            expect(xml).not.toContain("/console/about");
          }
          // A nested dynamic sitemap.ts answers at its segment with its params.
          expect(await (await get("/console/docs/guides/sitemap.xml")).text()).toContain(
            "<loc>https://shop.example/console/docs/guides?section=guides</loc>",
          );
          // robots.ts wins over the robots.txt agent.crawlers generates.
          const robots = await (await get("/console/robots.txt")).text();
          expect(robots).toBe("User-agent: *\nDisallow: /private\n");
          // llms.ts gets the generated pages and defaults to build on.
          const llms = await (await get("/console/llms.txt")).text();
          expect(llms).toMatch(/^# Custom index\n/);
          expect(llms).toContain("Paths: /, /about");
          expect(llms).toContain(`(${origin}/console/about.md)`);
          // An llms-full.ts object inlines each page's Markdown.
          const full = await (await get("/console/llms-full.txt")).text();
          expect(full).toMatch(/^# Custom full\n/);
          expect(full).toContain("About from a route file app");
        }
        if (name === "i18n") {
          const get = (pathname: string, headers: Record<string, string> = {}) =>
            fetch(origin + pathname, {
              headers,
              redirect: "manual",
              signal: AbortSignal.timeout(10_000),
            });
          for (const [pathname, accept, markers] of [
            ["/console/fr/about", "text/html", ["Locale fr from url: Bonjour", '<html lang="fr"']],
            ["/console/fr/about.rsc", "*/*", ["Locale fr from url: Bonjour", '"locale":"fr"']],
            ["/console/about", "text/html", ["Locale en from default: Hello", '<html lang="en"']],
            ["/console/fr/legacy", "text/html", ["Legacy fr in fr"]],
            // Client components render and hydrate with the request's locale and catalog.
            ["/console/fr/links", "text/html", ['href="/console/fr/about"', "Client fr: Bonjour"]],
          ] as const) {
            // An unsupported language leaves the default locale (fetch sends "*" otherwise).
            const response = await get(pathname, { accept, "accept-language": "de" });
            expect(response.status, `${pathname} ${logs}`).toBe(200);
            const body = await response.text();
            for (const marker of markers) expect(body, `${pathname} ${logs}`).toContain(marker);
          }

          // A page URL without a locale goes to the visitor's, varying on the signal it used.
          const detected = await get("/console/about", { "accept-language": "fr" });
          expect(detected.status, logs).toBe(307);
          expect(detected.headers.get("location")).toBe("/console/fr/about");
          expect(detected.headers.get("vary")).toContain("Accept-Language");
          expect(detected.headers.get("cache-control")).toBe("private, no-store");
          // Client navigation asks for the payload, and is sent to the localized one.
          const payload = await get("/console/about.rsc", { "accept-language": "fr" });
          expect(payload.status, logs).toBe(307);
          expect(payload.headers.get("location")).toBe("/console/fr/about.rsc");
          // The default locale's prefix is not canonical.
          const canonical = await get("/console/en/about");
          expect(canonical.status, logs).toBe(307);
          expect(canonical.headers.get("location")).toBe("/console/about");

          // API routes keep their URL and read the locale from the same signals.
          const api = await get("/api/locale", { "accept-language": "fr" });
          expect(api.status, logs).toBe(200);
          expect(await api.json()).toEqual({ locale: "fr", source: "accept-language" });
          expect(api.headers.get("vary")).toContain("Accept-Language");
          expect(api.headers.get("set-cookie")).toContain("farm_locale=fr");

          // The prerendered page and payload are served as files; the default locale's is rendered.
          for (const pathname of ["/console/fr/static", "/console/fr/static.rsc"]) {
            const prerendered = await get(pathname);
            expect(prerendered.status, `${pathname} ${logs}`).toBe(200);
            expect(prerendered.headers.get("last-modified"), pathname).toBeTruthy();
            expect(await prerendered.text()).toContain("Static fr");
          }
          const rendered = await get("/console/static", { "accept-language": "de" });
          expect(rendered.status, logs).toBe(200);
          expect(rendered.headers.get("last-modified")).toBeNull();
          expect(await rendered.text()).toContain("Static en");

          // redirect("/about") goes to the page in the request's locale, below the basePath.
          for (const [pathname, location] of [
            ["/console/fr/go", "/console/fr/about"],
            ["/console/go", "/console/about"],
          ]) {
            const redirected = await get(pathname, { "accept-language": "de" });
            expect(redirected.status, `${pathname} ${logs}`).toBe(307);
            expect(redirected.headers.get("location"), pathname).toBe(location);
          }
          // So does a server action's, submitted without JavaScript or called by the router.
          const form = await (await get("/console/fr/form", { "accept-language": "de" })).text();
          const actionField = /name="(\$ACTION_ID_[^"]+)"/.exec(form)?.[1];
          expect(actionField, form).toBeDefined();
          const formData = new FormData();
          formData.set(actionField!, "");
          const submitted = await fetch(origin + "/console/fr/form", {
            method: "POST",
            headers: { origin },
            body: formData,
            redirect: "manual",
          });
          expect(submitted.status, logs).toBe(303);
          expect(submitted.headers.get("location")).toBe("/console/fr/about");
          const called = await fetch(origin + "/console/fr/form", {
            method: "POST",
            headers: {
              origin,
              accept: "text/x-component",
              "content-type": "text/plain; charset=utf-8",
              "x-farm-action-id": actionField!.slice("$ACTION_ID_".length),
            },
            body: "[]",
          });
          expect(called.status, logs).toBe(200);
          expect(await called.text()).toContain('"redirect":{"url":"/console/fr/about"');
        }
        // A custom API prefix is not a server-action URL, even with actions enabled.
        const post = await fetch(`${origin}${mount}/echo`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://other.example" },
          body: JSON.stringify({ message: "hello" }),
        });
        expect(post.status, logs).toBe(200);
        expect(await post.json()).toEqual({ body: { message: "hello" } });
        const pagePost = await fetch(origin + "/", {
          method: "POST",
          headers: { origin: "https://other.example" },
          body: "not an action",
        });
        expect(pagePost.status).toBe(403);
        if (name === "default") {
          for (const [pathname, markers] of [
            ["/hook-control", ["Hook control"]],
            ["/hook-sniff", ["Hook scan", "async is just text"]],
            ["/hook-layout", ["Hook layout", "Hook layout page", "async is just text"]],
            ["/async-layout/42", ["Async layout", "42", "Async page"]],
          ] as const) {
            for (const accept of ["text/html", "text/x-component"]) {
              const response = await fetch(origin + pathname, {
                headers: { accept },
                signal: AbortSignal.timeout(10_000),
              });
              expect(response.status, logs).toBe(200);
              const body = await response.text();
              for (const marker of markers) expect(body, logs).toContain(marker);
            }
          }
        }

        const missing = await fetch(`${origin}${mount}/missing-api-route`);
        expect(missing.status).toBe(404);
        if (mount) expect((await missing.json()).error).toBe("API route not found");
        if (baseURL.startsWith("/")) {
          const clientURL = resolveFarmAPIRequestURL(
            "/api/root-runtime",
            JSON.parse(builder.config.define!.__FARM_API_BASE_URL__ as string),
            origin,
          );
          expect((await fetch(clientURL)).status).toBe(200);
        } else {
          expect((await fetch(origin + "/v1/root-runtime")).status).toBe(404);
        }
      } finally {
        if (child) await stopProcess(child);
        rmSync(fixtureRoot, { recursive: true, force: true });
        rmSync(isolatedRoot, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
