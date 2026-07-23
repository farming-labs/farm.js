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
import { resolveRscBuildOutputPath } from "./build-paths.js";
import farmRsc from "./index.js";
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
    await once(child, "exit");
  }
}

describe("RSC core runtime bundling", () => {
  it("does not prefix absolute Vite environment output paths with the project root", () => {
    const root = "/workspace/app";

    expect(resolveRscBuildOutputPath(root, "/workspace/app/.nitro/vite/dist/rsc", "index.js")).toBe(
      "/workspace/app/.nitro/vite/dist/rsc/index.js",
    );
    expect(resolveRscBuildOutputPath(root, ".nitro/vite/dist/ssr", "index.js")).toBe(
      "/workspace/app/.nitro/vite/dist/ssr/index.js",
    );
  });

  it("rewrites root runtime imports to focused standalone subpaths", async () => {
    const plugin = farmRsc().find(
      (candidate) => candidate.name === "@farmjs/plugin/rsc:core-runtime",
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
      } from "@farmjs/core";`,
      "/app/src/routes.ts",
      { ssr: false },
    );

    expect(transformed?.code).toContain('from "@farmjs/core/api"');
    expect(transformed?.code).toContain('from "@farmjs/core/routes"');
    expect(transformed?.code).toContain('from "@farmjs/core/request"');
    expect(transformed?.code).toContain('from "@farmjs/core/navigation"');
    expect(transformed?.code).toContain('from "@farmjs/core/cache"');
    expect(transformed?.code).toContain('from "@farmjs/core/query"');
    expect(transformed?.code).toContain('from "@farmjs/core/workflows"');
    expect(transformed?.code).not.toContain('from "@farmjs/core"');

    const resolveId = plugin?.resolveId as (
      id: string,
      importer: string | undefined,
      options: { ssr?: boolean },
    ) => unknown;
    expect(
      resolveId.call(
        { environment: { name: "ssr" } },
        "@farmjs/core/api/runtime",
        "/app/entry.rsc.tsx",
        { ssr: true },
      ),
    ).toBeNull();
    expect(
      resolveId.call({ environment: { name: "client" } }, "@farmjs/core", "/app/client.tsx", {
        ssr: false,
      }),
    ).toBeNull();
  });

  it("rewrites only the bounded core import after another named import", async () => {
    const plugin = farmRsc().find(
      (candidate) => candidate.name === "@farmjs/plugin/rsc:core-runtime",
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
} from "@farmjs/core";

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
      'import { redirect as go } from "@farmjs/core/navigation";',
    );
    expect(transformed?.code).not.toContain('from "@farmjs/core"');
    expect(transformed?.code).toContain("export const schema = z.string();");
  });

  it("rejects storage imports that cannot run from isolated RSC output", async () => {
    const plugin = farmRsc().find(
      (candidate) => candidate.name === "@farmjs/plugin/rsc:core-runtime",
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
        'import { memoryStorage } from "@farmjs/core";',
        "/app/src/storage.ts",
        { ssr: false },
      ),
    ).rejects.toThrow(/@farmjs\/core\/storage is not supported.*isolated server output/s);

    const resolveId = plugin?.resolveId as (
      id: string,
      importer: string | undefined,
      options: { ssr?: boolean },
    ) => unknown;
    expect(() =>
      resolveId.call(context, "@farmjs/core/storage", "/app/src/storage.ts", { ssr: false }),
    ).toThrow(/@farmjs\/core\/storage is not supported.*isolated server output/s);
  });

  it("builds and boots a real RSC app with exact-root runtime imports outside the workspace", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-root-runtime-"));
    const isolatedRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-root-output-"));
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    let child: ChildProcess | undefined;

    try {
      const srcDir = path.join(fixtureRoot, "src");
      mkdirSync(srcDir, { recursive: true });
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
        "@farmjs/core",
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
} from "@farmjs/core";

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
`,
      );

      const plugins = farmRsc({ routesDir: "" }).filter(
        (plugin) => plugin.name !== "@farmjs/plugin/rsc:nitro-build",
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
        experimental: { serverComponents: true, serverActions: false },
        plugins,
      } as never);
      await builder.buildApp();

      const rscPath = path.join(fixtureRoot, "dist", "rsc", "index.js");
      const ssrPath = path.join(fixtureRoot, "dist", "ssr", "index.js");
      const clientDir = path.join(fixtureRoot, "dist", "client");
      const rscCode = readFileSync(rscPath, "utf-8");
      expect(rscCode).not.toMatch(/from\s*["']@farmjs\/core["']/);

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
      expect(outputPackage.dependencies).not.toHaveProperty("@farmjs/core");
      for (const buildOnlyPackage of ["vite", "nitro", "rollup", "rolldown", "esbuild"]) {
        expect(outputPackage.dependencies).not.toHaveProperty(buildOnlyPackage);
        expect(existsSync(path.join(outputDir, "server", "node_modules", buildOnlyPackage))).toBe(
          false,
        );
      }
      expect(existsSync(path.join(outputDir, "server", "node_modules", "@farmjs", "core"))).toBe(
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
    } finally {
      if (child) await stopProcess(child);
      rmSync(fixtureRoot, { recursive: true, force: true });
      rmSync(isolatedRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
