// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startDevServer } from "../server/create-server";

async function verifyPolicy(
  request: (request: Request) => Promise<Response>,
  standaloneOnly: boolean,
) {
  const call = (method: string, token?: string, params?: unknown) =>
    request(
      new Request("http://farm.test/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
  const read = async (response: Response) => {
    expect(response.status).toBe(200);
    const text = await response.text();
    const data = response.headers.get("content-type")?.startsWith("text/event-stream")
      ? text
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6)
      : text;
    return JSON.parse(data!);
  };
  expect((await call("tools/list")).status).toBe(401);
  const reader = await read(await call("tools/list", "reader"));
  expect(reader.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
    ...(standaloneOnly ? [] : ["read_projects"]),
    "search_projects",
  ]);
  for (const tool of reader.result.tools) {
    expect(tool.outputSchema).toMatchObject({ type: "object", required: ["result"] });
  }
  const writer = await read(await call("tools/list", "writer"));
  expect(writer.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
    ...(standaloneOnly ? [] : ["read_projects", "create_project"]),
    "search_projects",
    "private_tool",
  ]);
  if (!standaloneOnly) {
    const denied = await read(
      await call("tools/call", "reader", {
        name: "create_project",
        arguments: { body: { name: "denied" } },
      }),
    );
    expect(denied.error).toBeDefined();
    const allowed = await read(
      await call("tools/call", "writer", {
        name: "create_project",
        arguments: { body: { name: "created" } },
      }),
    );
    expect(allowed.result.structuredContent).toEqual({
      result: { name: "created", calls: 1, actor: "writer" },
    });
    const invalid = await read(
      await call("tools/call", "writer", {
        name: "create_project",
        arguments: { body: { name: "" } },
      }),
    );
    expect(invalid.result.isError).toBe(true);
    const direct = await request(
      new Request("http://farm.test/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer reader" },
        body: JSON.stringify({ name: "denied" }),
      }),
    );
    expect(direct.status).toBe(403);
    const unchanged = await read(
      await call("tools/call", "reader", { name: "read_projects", arguments: {} }),
    );
    expect(unchanged.result.structuredContent).toEqual({ result: { calls: 1 } });
  } else {
    expect((await request(new Request("http://farm.test/api/projects"))).status).toBe(404);
  }
  const search = await read(
    await call("tools/call", "reader", { name: "search_projects", arguments: { query: " farm " } }),
  );
  expect(search.result.structuredContent).toEqual({
    result: { query: "FARM", actor: "reader", credential: "Bearer reader" },
  });
  const invalidOutput = await read(
    await call("tools/call", "reader", {
      name: "search_projects",
      arguments: { query: "farm", invalid: true },
    }),
  );
  expect(invalidOutput.result.isError).toBe(true);
  expect(invalidOutput.result.structuredContent).toBeUndefined();
  expect(invalidOutput.result.content).toEqual([
    {
      type: "text",
      text: 'MCP tool "search_projects" returned a value that does not match its output schema.',
    },
  ]);
  expect(JSON.stringify(invalidOutput)).not.toContain("private output");
  const forbidden = await read(
    await call("tools/call", "reader", { name: "private_tool", arguments: {} }),
  );
  expect(forbidden.error).toBeDefined();
  const privateResult = await read(
    await call("tools/call", "writer", { name: "private_tool", arguments: {} }),
  );
  expect(privateResult.result.structuredContent).toEqual({ result: { calls: 1 } });
  const malformed = await read(
    await call("tools/call", "reader", { name: "search_projects", arguments: { query: "" } }),
  );
  expect(malformed.result.isError).toBe(true);
  expect((await request(new Request("http://farm.test/api/search_projects"))).status).toBe(404);
  const events = await (
    await request(
      new Request("http://farm.test/api/events", {
        headers: { authorization: "Bearer writer" },
      }),
    )
  ).json();
  expect(events.map(({ tool, outcome }) => ({ tool, outcome }))).toEqual([
    ...(standaloneOnly
      ? []
      : [
          { tool: "create_project", outcome: "success" },
          { tool: "read_projects", outcome: "success" },
        ]),
    { tool: "search_projects", outcome: "success" },
    { tool: "search_projects", outcome: "error" },
    { tool: "private_tool", outcome: "success" },
  ]);
  for (const event of events) {
    expect(event).toMatchObject({
      type: "mcp.tool.complete",
      route: "/api/mcp",
      server: "projects",
      durationMs: expect.any(Number),
    });
    expect(Object.keys(event).sort()).toEqual([
      "durationMs",
      "level",
      "outcome",
      "route",
      "server",
      "timestamp",
      "tool",
      "type",
    ]);
  }
  expect(JSON.stringify(events)).not.toMatch(/Bearer|private output|credential|subject/);
}

describe("MCP composition and authorization", () => {
  it.each([false, true])(
    "preserves the policy in Vite and Vercel (standalone only: %s)",
    async (standaloneOnly) => {
      const packageRoot = process.cwd();
      const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-mcp-policy-"));
      const eventKey = `mcp-test-${path.basename(root)}`;
      try {
        await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
        for (const [name, source] of [
          ["core", packageRoot],
          ["mcp", path.resolve(packageRoot, "../farm-mcp")],
        ]) {
          await fs.symlink(source!, path.join(root, "node_modules", "@farm.js", name!), "junction");
        }
        await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
        await fs.mkdir(path.join(root, "src", "app", "api", "projects"), { recursive: true });
        await fs.mkdir(path.join(root, "src", "app", "api", "events"), { recursive: true });
        await fs.writeFile(
          path.join(root, "src", "app", "api", "events", "route.ts"),
          `
export function GET(request) {
  if (request.headers.get("authorization") !== "Bearer writer") return new Response(null, { status: 403 });
  return Response.json((globalThis[${JSON.stringify(eventKey)}] ?? []).splice(0));
}
`,
        );
        await fs.writeFile(
          path.join(root, "src", "app", "page.tsx"),
          "export default function Page() { return <main>MCP policy</main>; }",
        );
        if (!standaloneOnly)
          await fs.writeFile(
            path.join(root, "src", "app", "api", "projects", "route.ts"),
            `
import { createEndpoint, createRouteFactory } from "@farm.js/core/api";
import { z } from "zod";
let calls = 0;
function authorize({ request }) {
  const token = request.headers.get("authorization");
  if (token !== "Bearer writer" && token !== "Bearer reader") return Response.json({}, { status: 401 });
  if (request.method === "POST" && token !== "Bearer writer") return Response.json({}, { status: 403 });
  return { actor: token.slice(7) };
}
export const GET = createRouteFactory().get("/api/projects", {
  middleware: [authorize], output: z.object({ calls: z.number() }), handler: () => ({ calls }),
}).endpoint;
export const POST = createEndpoint("/api/projects", {
  method: "POST", middleware: [authorize], body: z.object({ name: z.string().min(1) }),
}, ({ body, context }) => ({ name: body.name, calls: ++calls, actor: context.actor }));
`,
          );
        await fs.writeFile(
          path.join(root, "farm.config.ts"),
          `
import { defineConfig } from "@farm.js/core";
import { defineTool } from "@farm.js/mcp";
import { z } from "zod";
${standaloneOnly ? "" : 'import { GET, POST } from "./src/app/api/projects/route";'}
let privateCalls = 0;
export default defineConfig({
  telemetry: false,
  observability: {
    events: ["mcp.tool.complete"],
    onEvent(event) { (globalThis[${JSON.stringify(eventKey)}] ??= []).push(event); },
  },
  images: { provider: "none" },
  vite: { server: { host: "127.0.0.1", strictPort: false } },
  mcp: {
    name: "projects",
    tools: [
      ${standaloneOnly ? "" : '{ endpoint: GET, name: "read_projects" }, { endpoint: POST, name: "create_project" },'}
      defineTool({ name: "search_projects", inputSchema: z.object({ query: z.string().trim().min(1), invalid: z.boolean().optional() }),
        outputSchema: z.object({ query: z.string().transform(value => value.toUpperCase()).pipe(z.string()), actor: z.string(), credential: z.string().nullable() }),
        execute: ({ query, invalid }, { authorization, request, signal }) => {
          signal.throwIfAborted();
          return { query: invalid ? 42 : query, actor: authorization.subject, credential: request.headers.get("authorization"), secret: "private output" };
        },
      }),
      defineTool({ name: "private_tool", inputSchema: z.object({}), execute: () => ({ calls: ++privateCalls }) }),
    ],
    authorize: ({ request, tools, server }) => {
      if (server.name !== "projects" || server.path !== "/api/mcp" || tools.length !== ${standaloneOnly ? 2 : 4} || tools.find(tool => tool.name === "search_projects")?.kind !== "standalone") throw new Error("Missing MCP authorization context");
      const token = request.headers.get("authorization");
      if (token !== "Bearer reader" && token !== "Bearer writer") return false;
      return { subject: token.slice(7), tools: tools.filter(tool => token === "Bearer writer" || ["read_projects", "search_projects"].includes(tool.name)).map(tool => tool.name) };
    },
  },
});
`,
        );
        const dev = await startDevServer({ root }, 0);
        try {
          const address = dev.httpServer!.address();
          if (!address || typeof address === "string") throw new Error("Dev server did not bind");
          await verifyPolicy(
            (request) =>
              fetch(
                new Request(
                  `http://127.0.0.1:${address.port}${new URL(request.url).pathname}`,
                  request,
                ),
              ),
            standaloneOnly,
          );
        } finally {
          await dev.close();
        }
        const config = await resolveConfig(
          { ...(await loadConfig(root, undefined, "production")), root },
          "production",
        );
        await build(config, { root, preset: "vercel" });
        // Prove config references do not need source modules or a Vite module cache at runtime.
        await fs.rename(path.join(root, "src"), path.join(root, "source-not-deployed"));
        await fs.rename(
          path.join(root, "farm.config.ts"),
          path.join(root, "config-not-deployed.ts"),
        );
        const entry = path.join(
          root,
          ".vercel",
          "output",
          "functions",
          "__nitro.func",
          "index.mjs",
        );
        const server = await import(/* @vite-ignore */ pathToFileURL(entry).href);
        await verifyPolicy((request) => server.default.fetch(request), standaloneOnly);
        const clientDir = path.join(root, ".farm", "client");
        for (const file of await fs.readdir(clientDir, { recursive: true })) {
          if (!file.endsWith(".js")) continue;
          expect(await fs.readFile(path.join(clientDir, file), "utf8")).not.toContain(
            "Missing MCP authorization context",
          );
        }
      } finally {
        delete (globalThis as any)[eventKey];
        await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    },
    120_000,
  );
});
