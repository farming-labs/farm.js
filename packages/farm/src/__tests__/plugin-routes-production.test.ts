// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { describe, expect, it, onTestFailed } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startDevServer } from "../server/create-server";

const execFileAsync = promisify(execFile);

describe("published plugin routes", () => {
  it("builds typed callers and serves validated routes from the Vercel output", async () => {
    let phase = "fixture setup";
    onTestFailed(() => console.error(`Plugin routes production test failed during: ${phase}`));
    const packageRoot = process.cwd();
    const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-plugin-routes-"));
    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      await fs.mkdir(path.join(root, "src", "app", "api", "shared"), { recursive: true });
      await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
      await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
      await fs.mkdir(path.join(root, "src", "lib"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "lib", "api.ts"),
        `
import { createApiClients } from "@farm.js/core/client";
import { apiRoutes, type APIRouter } from "./api.generated";
export const { api, apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });
`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `"use client";
import { apiClient } from "../lib/api";
export default function Page() {
  return <button onClick={() => apiClient.projects.$params({ projectId: "p1" }).uploads.post({ params: { uploadId: "u1" }, body: { title: "Hello" }, headers: { "x-token": "valid" } })}>Plugin routes</button>;
}`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "api", "shared", "route.ts"),
        `import { api } from "../../../lib/api";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const result = await api.projects.$params({ projectId: "p1" }).uploads.post({
    params: { uploadId: "u1" }, body: { title: query.get("title") ?? " Local " },
    headers: { "x-token": query.get("token") ?? "valid" },
  });
  return Response.json({ source: "file", data: result.data, error: result.error?.status ?? null });
}`,
      );
      await fs.mkdir(path.join(root, "src", "app", "server"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "server", "page.tsx"),
        `
import { api } from "../../lib/api";
export default async function Page() {
  const result = await api.shared.get();
  if (result.error) throw result.error;
  return <pre>{JSON.stringify(result.data)}</pre>;
}`,
      );
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `
import { defineConfig, definePlugin } from "@farm.js/core";
import type { PluginRequestContext } from "@farm.js/core/plugin";
import { z } from "zod";
let readContext: PluginRequestContext["get"] = () => undefined;
export default defineConfig({
  telemetry: false,
  api: { basePath: "/backend/v2" },
  vite: { server: { host: "127.0.0.1", strictPort: false } },
  plugins: [definePlugin({
    name: "test:published-routes",
    setup({ requestContext }) { readContext = requestContext.get; },
    routes: ({ route }) => {
      const project = route.scope("/api/projects/[projectId]");
      return [
        project.post("uploads/[uploadId]", {
          input: {
            params: z.object({ projectId: z.string(), uploadId: z.string() }),
            body: z.object({ title: z.string().trim().min(1).refine(async value => value !== "blocked") }),
            headers: z.object({ "x-token": z.string() }),
          },
          middleware: [({ request }) => request.headers.get("x-token") === "valid" ? true : Response.json({ error: "Unauthorized" }, { status: 401 })],
          output: z.object({ id: z.string(), title: z.string() }),
          handler(_request, { input }) {
            if (input.body.title === "private") throw new Error("server-only-plugin-route-sentinel");
            return { id: input.params.projectId + "/" + input.params.uploadId, title: input.body.title };
          },
        }),
        route.post("/api/shared", { handler: () => ({ source: "plugin" }) }),
        route.post("/api/context", { handler: (request) => ({ preserved: readContext(request, "fixture.private") === "private-context-sentinel" }) }),
      ];
    },
    runtime: {
      before({ req }) { req.set("fixture.private", "private-context-sentinel"); },
      after({ response }) { const headers = new Headers(response.headers); headers.set("x-plugin-route", "yes"); return new Response(response.body, { status: response.status, headers }); }
    },
  })],
});
`,
      );
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await expect(build(config, { root, universal: false })).rejects.toThrow(
        "Plugin API routes require the default universal production build",
      );
      // The app config owns Vite settings; createServer's argument only locates it.
      phase = "development requests and HMR";
      const dev = await startDevServer({ root }, 0);
      try {
        const address = dev.httpServer!.address();
        if (!address || typeof address === "string")
          throw new Error("Dev server did not bind a TCP port");
        expect(address.address).toBe("127.0.0.1");
        const contextResponse = await fetch(`http://127.0.0.1:${address.port}/backend/v2/context`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        expect(await contextResponse.json()).toEqual({ preserved: true });
        const response = await fetch(
          `http://127.0.0.1:${address.port}/backend/v2/projects/p1/uploads/u1`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-token": "valid" },
            body: JSON.stringify({ title: " Dev " }),
          },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("x-plugin-route")).toBe("yes");
        expect(await response.json()).toEqual({ id: "p1/u1", title: "Dev" });
        const local = await fetch(`http://127.0.0.1:${address.port}/backend/v2/shared`);
        expect(await local.json()).toEqual({
          source: "file",
          data: { id: "p1/u1", title: "Local" },
          error: null,
        });
        const denied = await fetch(
          `http://127.0.0.1:${address.port}/backend/v2/shared?token=invalid`,
        );
        expect((await denied.json()).error).toBe(401);
        const page = await fetch(`http://127.0.0.1:${address.port}/server`);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain("p1/u1");
        const sharedFile = path.join(root, "src", "app", "api", "shared", "route.ts");
        const before = await fs.readFile(sharedFile, "utf8");
        await fs.writeFile(sharedFile, before.replace('source: "file"', 'source: "hmr-local"'));
        await expect
          .poll(
            async () => {
              const updated = await fetch(`http://127.0.0.1:${address.port}/server`);
              return updated.text();
            },
            { timeout: 10_000 },
          )
          .toContain("hmr-local");
        await fs.writeFile(sharedFile, before);
      } finally {
        const requestPhase = phase;
        phase = "development server shutdown";
        await dev.close();
        phase = requestPhase;
      }
      phase = "production build";
      await build(config, { root, preset: "vercel" });

      phase = "generated caller type checking";
      const caller = path.join(root, "src", "caller.ts");
      await fs.writeFile(
        caller,
        `
import { api, apiClient } from "./lib/api";
const project = api.projects.$params({ projectId: "p1" });
async function check() {
  const result = await project.uploads.post({ params: { uploadId: "u1" }, body: { title: "Hello" }, headers: { "x-token": "valid" } });
  const id: string | undefined = result.data?.id;
  // @ts-expect-error unknown response properties are rejected (not any).
  result.data?.missing;
  // @ts-expect-error missing dynamic ID.
  project.uploads.post({ body: { title: "Hello" }, headers: { "x-token": "valid" } });
  // @ts-expect-error only POST is registered.
  project.uploads.get({ params: { uploadId: "u1" } });
  // @ts-expect-error params bind at their declared location.
  api.projects.$params({ uploadId: "u1" });
  const clientResult = await apiClient.projects.$params({ projectId: "p1" }).uploads.post({ params: { uploadId: "u1" }, body: { title: "Hello" }, headers: { "x-token": "valid" } });
  const clientId: string | undefined = clientResult.data?.id;
  // @ts-expect-error browser callers retain required input too.
  apiClient.projects.$params({ projectId: "p1" }).uploads.post({ params: { uploadId: "u1" } });
  // @ts-expect-error client output cannot become any.
  clientResult.data?.missing;
  return id;
}
void check;
`,
      );
      const program = ts.createProgram([caller], {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      });
      const diagnostics = ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      expect(diagnostics).toEqual([]);
      const generated = await fs.readFile(
        path.join(root, "src", "lib", "api.generated.ts"),
        "utf8",
      );
      const emitted = ts.transpileModule(generated, {
        compilerOptions: { module: ts.ModuleKind.ESNext },
      }).outputText;
      expect(emitted).not.toContain("farm.config");
      expect(emitted).not.toContain("zod");
      expect(emitted).not.toContain("handler");
      const clientDir = path.join(root, ".farm", "client");
      const clientFiles = (await fs.readdir(clientDir, { recursive: true })).filter((file) =>
        file.endsWith(".js"),
      );
      expect(clientFiles.length).toBeGreaterThan(0);
      for (const file of clientFiles) {
        expect(await fs.readFile(path.join(clientDir, file), "utf8")).not.toContain(
          "server-only-plugin-route-sentinel",
        );
      }

      phase = "production requests in isolated process";
      const entry = path.join(root, ".vercel", "output", "functions", "__nitro.func", "index.mjs");
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          fileURLToPath(new URL("./fixtures/plugin-routes-production-probe.mjs", import.meta.url)),
          pathToFileURL(entry).href,
        ],
        { cwd: packageRoot, timeout: 30_000 },
      );
      expect(stdout.trim()).toBe("plugin routes verified");
      // Importing the runtime here retains its bundled Rolldown native binding
      // until the test worker exits, preventing fixture cleanup on Windows.
      phase = "native module lifetime check";
      expect(
        (process.report.getReport() as { sharedObjects: string[] }).sharedObjects.filter((file) =>
          file.startsWith(root),
        ),
      ).toEqual([]);
    } finally {
      const testPhase = phase;
      phase = "fixture cleanup";
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      phase = testPhase;
    }
  }, 120_000);
});
