// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startDevServer } from "../server/create-server";

describe("published plugin routes", () => {
  it("builds typed callers and serves validated routes from the Vercel output", async () => {
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
import { z } from "zod";
export default defineConfig({
  telemetry: false,
  api: { basePath: "/backend/v2" },
  vite: { server: { host: "127.0.0.1", strictPort: false } },
  plugins: [definePlugin({
    name: "test:published-routes",
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
      ];
    },
    runtime: { after({ response }) { const headers = new Headers(response.headers); headers.set("x-plugin-route", "yes"); return new Response(response.body, { status: response.status, headers }); } },
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
      const dev = await startDevServer({ root }, 0);
      try {
        const address = dev.httpServer!.address();
        if (!address || typeof address === "string")
          throw new Error("Dev server did not bind a TCP port");
        expect(address.address).toBe("127.0.0.1");
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
        await dev.close();
      }
      await build(config, { root, preset: "vercel" });

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

      const entry = path.join(root, ".vercel", "output", "functions", "__nitro.func", "index.mjs");
      const server = await import(pathToFileURL(entry).href);
      const call = (title: string, token = "valid") =>
        server.default.fetch(
          new Request("http://farm.test/backend/v2/projects/p1/uploads/u1", {
            method: "POST",
            headers: { "content-type": "application/json", "x-token": token },
            body: JSON.stringify({ title }),
          }),
        );
      const response = await call("  Hello  ");
      expect(response.status).toBe(200);
      expect(response.headers.get("x-plugin-route")).toBe("yes");
      expect(await response.json()).toEqual({ id: "p1/u1", title: "Hello" });
      expect((await call("blocked")).status).toBe(400);
      expect((await call("Hello", "invalid")).status).toBe(401);
      const network = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Local api must not fetch"));
      try {
        const page = await server.default.fetch(new Request("http://farm.test/server"));
        expect(page.status).toBe(200);
        expect(await page.text()).toContain("p1/u1");
        const shared = await server.default.fetch(
          new Request("http://farm.test/backend/v2/shared"),
        );
        expect(await shared.json()).toEqual({
          source: "file",
          data: { id: "p1/u1", title: "Local" },
          error: null,
        });
        const denied = await server.default.fetch(
          new Request("http://farm.test/backend/v2/shared?token=invalid"),
        );
        expect((await denied.json()).error).toBe(401);
        const invalid = await server.default.fetch(
          new Request("http://farm.test/backend/v2/shared?title=blocked"),
        );
        expect((await invalid.json()).error).toBe(400);
        const failed = await server.default.fetch(
          new Request("http://farm.test/backend/v2/shared?title=private"),
        );
        expect((await failed.json()).error).toBe(500);
        expect(network).not.toHaveBeenCalled();
      } finally {
        network.mockRestore();
      }
      const sharedPost = await server.default.fetch(
        new Request("http://farm.test/backend/v2/shared", { method: "POST" }),
      );
      expect(await sharedPost.json()).toEqual({ source: "plugin" });
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 120_000);
});
