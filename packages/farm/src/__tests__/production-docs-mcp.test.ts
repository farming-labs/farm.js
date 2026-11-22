// @vitest-environment node

import fs from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

// A docs runtime serves its own MCP server and lists it with registerMCPServer. Farm lists its
// tools in /.well-known/farmjs.json and reports each call to Farm Infra, as for @farm.js/mcp.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A stateless server: answers initialize, tools/list and tools/call over server-sent events;
 * `broken` fails, `missing` is refused.
 */
const ADAPTER_SERVER = `let listed = 0;
export function createFarmDocsRuntimeHandler(_config, options) {
  options.registerMCPServer?.({ name: "dev.farmjs/docs", version: "0.2.145", path: "/mcp" });
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/docs-listed") return Response.json({ listed });
    if (pathname !== "/mcp") return null;
    const message = await request.json();
    let reply;
    if (message.method === "initialize") {
      reply = {
        result: {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "dev.farmjs/docs", version: "0.2.145" },
        },
      };
    } else if (message.method === "tools/list") {
      listed++;
      reply = {
        result: {
          tools: [
            { name: "list_pages", title: "List docs pages", annotations: { readOnlyHint: true },
              inputSchema: { type: "object" } },
            { name: "broken" },
          ],
        },
      };
    } else if (message.params.name === "missing") {
      reply = { error: { code: -32602, message: "Unknown tool" } };
    } else {
      reply = { result: { content: [], ...(message.params.name === "broken" ? { isError: true } : {}) } };
    }
    const body = JSON.stringify({ jsonrpc: "2.0", id: message.id, ...reply });
    return new Response("event: message\\ndata: " + body + "\\n\\n", {
      headers: { "content-type": "text/event-stream" },
    });
  };
}
`;

async function write(root: string, relativePath: string, source: string) {
  await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
  await fs.writeFile(path.join(root, relativePath), source);
}

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-docs-mcp-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await write(
    root,
    "node_modules/fake-docs-adapter/package.json",
    JSON.stringify({
      name: "fake-docs-adapter",
      type: "module",
      exports: { "./server": "./server.js", "./react": "./react.js" },
    }),
  );
  await write(root, "node_modules/fake-docs-adapter/server.js", ADAPTER_SERVER);
  await write(
    root,
    "node_modules/fake-docs-adapter/react.js",
    "export function hydrateFarmDocs() {}",
  );
  await write(root, "package.json", '{"type":"module","private":true}');
  await write(root, "docs.config.ts", 'export default { entry: "docs" };\n');
  await write(
    root,
    "src/app/layout.tsx",
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  );
  await write(root, "src/app/page.tsx", "export default function Page() { return <p>home</p>; }");
  return root;
}

describe("a docs runtime's MCP server in production", () => {
  it("lists its tools in the manifest and reports each call to Farm Infra", async () => {
    const root = await createFixture();
    const received: string[] = [];
    const receiver = createHttpServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        received.push(body);
        response.writeHead(202).end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const receiverPort = (receiver.address() as { port: number }).port;
    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          docs: {
            enabled: true,
            entry: "/docs",
            adapter: {
              id: "fake",
              protocol: 1,
              server: "fake-docs-adapter/server",
              react: "fake-docs-adapter/react",
            },
          },
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const server = await startProductionServer(path.join(root, ".farm", ".output", "server"), {
        env: {
          FARMJS_API_KEY: `fti_${"r".repeat(43)}`,
          FARMJS_API_URL: `http://127.0.0.1:${receiverPort}`,
        },
      });
      try {
        // Cursor names itself only in initialize; Farm hands it a session ID that names it.
        const initialized = await fetch(`${server.origin}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "cursor-vscode", version: "2.1.0" },
            },
          }),
        });
        expect(initialized.status).toBe(200);
        expect(await initialized.text()).toContain('"serverInfo"');
        const session = initialized.headers.get("mcp-session-id")!;
        expect(session).toMatch(/^farm\.cursor\.[0-9a-f]{32}$/);
        const callTool = async (id: number, name: string) => {
          const response = await fetch(`${server.origin}/mcp`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              "mcp-session-id": session,
              "mcp-protocol-version": "2025-06-18",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id,
              method: "tools/call",
              params: { name, arguments: { query: "private-argument" } },
            }),
          });
          expect(response.status).toBe(200);
          return response.text();
        };
        // The client gets the docs runtime's answer as it sent it.
        await expect(callTool(1, "list_pages")).resolves.toBe(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [] } })}\n\n`,
        );
        await callTool(2, "broken");
        await callTool(3, "missing");

        const manifest = await fetch(`${server.origin}/.well-known/farmjs.json`);
        expect(manifest.status).toBe(200);
        expect((await manifest.json()).mcp.servers).toEqual([
          {
            name: "dev.farmjs/docs",
            version: "0.2.145",
            path: "/mcp",
            authorization: "none",
            resources: [],
            prompts: [],
            tools: [
              {
                name: "list_pages",
                title: "List docs pages",
                source: "defineTool",
                readOnlyHint: true,
                inputSchema: { type: "object" },
              },
              { name: "broken", source: "defineTool" },
            ],
          },
        ]);
        // A production build's tools can't change, so they are read once.
        await fetch(`${server.origin}/.well-known/farmjs.json`).then((response) => response.text());
        expect(await (await fetch(`${server.origin}/docs-listed`)).json()).toEqual({ listed: 1 });

        const events = () => received.flatMap((body) => JSON.parse(body).events);
        await vi.waitFor(
          () => expect(events().filter(({ kind }) => kind === "mcp.tool")).toHaveLength(2),
          { timeout: 5_000 },
        );
        const calls = events().filter(({ kind }) => kind === "mcp.tool");
        const cursor = {
          family: "other",
          category: "harness",
          identity: "self-reported",
          name: "Cursor",
        };
        expect(calls).toEqual([
          expect.objectContaining({
            route: "/mcp",
            tool: "list_pages",
            outcome: "success",
            agent: cursor,
          }),
          expect.objectContaining({
            route: "/mcp",
            tool: "broken",
            outcome: "error",
            agent: cursor,
          }),
        ]);
        // Each call is tied to the request that carried it.
        const requests = events().filter(
          ({ kind, method }) => kind === "request" && method === "POST",
        );
        expect(requests).toHaveLength(4);
        expect(requests.every(({ agent }) => agent.name === "Cursor")).toBe(true);
        expect(JSON.stringify(events())).not.toContain(session);
        for (const call of calls) {
          expect(requests.map(({ requestId }) => requestId)).toContain(call.requestId);
        }
        // A tool call carries its arguments and result; the request carrying it doesn't.
        expect(calls.map(({ arguments: args }) => args)).toEqual(
          calls.map(() => ({ query: "private-argument" })),
        );
        expect(calls.every(({ result }) => typeof result === "object")).toBe(true);
        expect(JSON.stringify(requests)).not.toContain("private-argument");
      } finally {
        await server.stop();
      }
    } finally {
      await new Promise((resolve) => receiver.close(resolve));
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 180_000);
});
