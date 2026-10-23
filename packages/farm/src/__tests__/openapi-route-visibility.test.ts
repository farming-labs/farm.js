// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startDevServer } from "../server/create-server";

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [file, source] of Object.entries(files)) {
    const filePath = path.join(root, file);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, source);
  }
}

const statusOperation = {
  summary: "Service status",
  responses: { 200: { description: "The service is up" } },
};

// The API catalog keeps pointing agents at the spec.
function expectCatalogedSpec(catalog: any): void {
  expect(catalog.linkset[1]["service-desc"]).toEqual([
    { href: "/openapi.json", type: "application/vnd.oai.openapi+json" },
  ]);
}

// The same document must come out of `farm dev` and `farm build`.
function expectDescribedRoutes(spec: any): void {
  expect(Object.keys(spec.paths).sort()).toEqual(["/items", "/projects/{projectId}", "/status"]);
  // Hidden: the createEndpoint GET, the whole plain-function admin route, and a plugin route.
  expect(Object.keys(spec.paths["/items"])).toEqual(["post"]);
  // The route imports its schema without a file extension, so this needs the loaded route.
  expect(spec.paths["/items"].post.requestBody).toMatchObject({
    required: true,
    content: {
      "application/json": {
        schema: { type: "object", properties: { name: { type: "string" } } },
      },
    },
  });
  expect(spec.paths["/projects/{projectId}"].get.parameters).toEqual([
    { name: "projectId", in: "path", required: true, schema: { type: "string" } },
    expect.objectContaining({ name: "view", in: "query", required: true }),
  ]);
  expect(spec.paths["/status"].get).toEqual(statusOperation);
}

describe("OpenAPI route visibility", () => {
  it("describes the mounted routes the same way in dev and production", async () => {
    const packageRoot = process.cwd();
    const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-openapi-visibility-"));
    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      await writeFiles(root, {
        "package.json": '{"type":"module"}',
        "src/app/globals.css": "",
        "src/app/page.tsx": "export default function Page() { return <main>home</main>; }\n",
        "src/lib/schemas.ts": `import { z } from "zod";
export const itemSchema = z.object({ name: z.string() });
`,
        "src/app/api/items/route.ts": `import { createEndpoint } from "@farm.js/core/api";
import { itemSchema } from "../../../lib/schemas";
export const GET = createEndpoint({ method: "GET", openapi: { hidden: true } }, async () => ({ items: [] }));
export const POST = createEndpoint({ method: "POST", body: itemSchema }, async ({ body }) => body);
`,
        "src/lib/session.ts": `export const sessionCookie = "admin_session";\n`,
        "src/app/api/admin/session/route.ts": `import { sessionCookie } from "../../../../lib/session";
export const openapi = { hidden: true };
export function POST() {
  return new Response(null, { status: 303, headers: { location: "/", "set-cookie": sessionCookie + "=1" } });
}
`,
        "farm.config.ts": `import { defineConfig, definePlugin } from "@farm.js/core";
import { z } from "zod";
export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  vite: { server: { host: "127.0.0.1", strictPort: false } },
  agent: { apiCatalog: true },
  openapi: {
    enabled: true,
    route: "/reference",
    title: "Visibility API",
    paths: { "/status": { get: ${JSON.stringify(statusOperation)} } },
  },
  plugins: [definePlugin({
    name: "test:openapi-plugin-routes",
    routes: ({ route }) => [
      route.get("/api/projects/[projectId]", {
        input: { query: z.object({ view: z.enum(["summary", "full"]) }) },
        handler: (_request, { input }) => ({ view: input.query.view }),
      }),
      route.post("/api/projects/internal", { openapi: { hidden: true }, handler: () => ({ ok: true }) }),
    ],
  })],
});
`,
      });

      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");

      const dev = await startDevServer({ root }, 0);
      try {
        const address = dev.httpServer!.address();
        if (!address || typeof address === "string") throw new Error("Missing dev server address");
        const origin = `http://127.0.0.1:${address.port}`;
        expectDescribedRoutes(await (await fetch(`${origin}/openapi.json`)).json());
        expectCatalogedSpec(await (await fetch(`${origin}/.well-known/api-catalog`)).json());
        // Hidden routes are still served.
        const session = await fetch(`${origin}/api/admin/session`, {
          method: "POST",
          redirect: "manual",
        });
        expect(session.status).toBe(303);
      } finally {
        await dev.close();
      }

      await build(config, { root, preset: "vercel" });
      const entry = path.join(root, ".vercel", "output", "functions", "__nitro.func", "index.mjs");
      const server = await import(pathToFileURL(entry).href);
      const spec = await server.default.fetch(new Request("http://farm.test/openapi.json"));
      expect(spec.status).toBe(200);
      expectDescribedRoutes(await spec.json());
      const catalog = await server.default.fetch(
        new Request("http://farm.test/.well-known/api-catalog"),
      );
      expectCatalogedSpec(await catalog.json());
      const session = await server.default.fetch(
        new Request("http://farm.test/api/admin/session", { method: "POST" }),
      );
      expect(session.status).toBe(303);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 180_000);
});
