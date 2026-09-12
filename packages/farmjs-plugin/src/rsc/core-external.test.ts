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
              "error.tsx",
              `"use client"; export default function ErrorPage({ error, reset, path, searchParams }) {
              return <main>Route error rendered <p>{error.message}</p><p>{path}</p><p>{JSON.stringify(searchParams)}</p><button onClick={reset}>Reset</button></main>;
            }`,
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
        const fixtureModules = path.join(fixtureRoot, "node_modules");
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
          `export default function Layout({ children }) {
  return <html><body>{children}</body></html>;
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
          api,
          plugins,
        } as never);
        expect(builder.config.define?.__FARM_API_BASE_URL__).toBe(JSON.stringify(baseURL));
        await builder.buildApp();

        const rscPath = path.join(fixtureRoot, "dist", "rsc", "index.js");
        const ssrPath = path.join(fixtureRoot, "dist", "ssr", "index.js");
        const clientDir = path.join(fixtureRoot, "dist", "client");
        const rscCode = readFileSync(rscPath, "utf-8");
        expect(rscCode).not.toMatch(/from\s*["']@farm.js\/core["']/);

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
        for (const buildOnlyPackage of ["vite", "nitro", "rollup", "rolldown", "esbuild"]) {
          expect(outputPackage.dependencies).not.toHaveProperty(buildOnlyPackage);
          expect(existsSync(path.join(outputDir, "server", "node_modules", buildOnlyPackage))).toBe(
            false,
          );
        }
        expect(existsSync(path.join(outputDir, "server", "node_modules", "@farm.js", "core"))).toBe(
          false,
        );

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
