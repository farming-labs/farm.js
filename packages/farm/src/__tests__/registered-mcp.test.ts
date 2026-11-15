import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFarmAppManifestResponse,
  resolveFarmAppManifestInput,
  type FarmAppManifestServer,
} from "../app-manifest";
import { _publishFarmMCPCatalog, registerFarmMCPServer } from "../mcp-catalog";
import { onFarmEvent } from "../observability";
import {
  _listFarmRegisteredMCPServerTools,
  _observeFarmRegisteredMCPResponse,
  _readFarmRegisteredMCPCalls,
} from "../registered-mcp";

type Message = { jsonrpc: "2.0"; id?: number | string; method: string; params?: any };

const cleanup: (() => void)[] = [];
const events: Record<string, unknown>[] = [];
beforeEach(() => {
  cleanup.push(
    registerFarmMCPServer({ name: "dev.farmjs/docs", version: "0.2.145", path: "/mcp" }),
    onFarmEvent((event) => void events.push(event as Record<string, unknown>), {
      unfiltered: true,
    }),
  );
});
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  events.length = 0;
});

const toolEvents = () => events.filter((event) => event.type === "mcp.tool.complete");

const TOOLS = [
  {
    name: "list_pages",
    title: "List docs pages",
    description: "List the known documentation pages.",
    inputSchema: { type: "object", properties: { cursor: { type: "string" } } },
    outputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
  },
  { name: "get_context", annotations: { title: "Get context", openWorldHint: false } },
];

/** A docs runtime's MCP server: tools/list, and tools/call that fails `fail` and refuses `missing`. */
function docsMCP({ eventStream = false } = {}) {
  const seen: string[] = [];
  const answer = (message: Message) => {
    if (message.method === "tools/list") return { tools: TOOLS };
    if (message.params?.name === "missing") return undefined;
    return { content: [], ...(message.params?.name === "fail" ? { isError: true } : {}) };
  };
  const handle = async (request: Request): Promise<Response | null> => {
    // At the app's base path too.
    if (!new URL(request.url).pathname.endsWith("/mcp")) return null;
    const text = await request.text();
    seen.push(text);
    const parsed = JSON.parse(text) as Message | Message[];
    const replies = (Array.isArray(parsed) ? parsed : [parsed]).map((message) => {
      const result = answer(message);
      return result
        ? { jsonrpc: "2.0", id: message.id, result }
        : { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Unknown tool" } };
    });
    return eventStream
      ? new Response(
          replies.map((reply) => `event: message\ndata: ${JSON.stringify(reply)}\n\n`).join(""),
          { headers: { "content-type": "text/event-stream" } },
        )
      : Response.json(Array.isArray(parsed) ? replies : replies[0]);
  };
  return { handle, seen };
}

const call = (id: number | string, name: string): Message => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: { query: "private" } },
});

function post(body: unknown, { path = "/mcp", type = "application/json" } = {}) {
  return new Request(`https://farmjs.dev${path}`, {
    method: "POST",
    headers: { "content-type": type, accept: "application/json, text/event-stream" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function serve(
  request: Request,
  handle: (request: Request) => Promise<Response | null>,
  basePath?: string,
) {
  const observed = await _readFarmRegisteredMCPCalls(request, basePath);
  const response = await handle(request);
  return _observeFarmRegisteredMCPResponse(response!, observed);
}

describe("tool calls to a docs runtime's MCP server", () => {
  for (const eventStream of [false, true]) {
    it(`reports each call it answers with a result, ${eventStream ? "streamed" : "as JSON"}`, async () => {
      const server = docsMCP({ eventStream });
      const body = [call(1, "list_pages"), call(2, "fail"), call(3, "missing"), call("4", "x.y")];
      const response = await serve(post(body), server.handle);
      // The client gets the server's whole answer, and the server the whole request.
      const text = await response.text();
      expect(text).toContain('"id":3');
      expect(server.seen).toEqual([JSON.stringify(body)]);
      await vi.waitFor(() => expect(toolEvents()).toHaveLength(3));
      expect(toolEvents()).toEqual([
        expect.objectContaining({
          route: "/mcp",
          server: "dev.farmjs/docs",
          tool: "list_pages",
          outcome: "success",
          level: "info",
          durationMs: expect.any(Number),
        }),
        expect.objectContaining({ tool: "fail", outcome: "error", level: "error" }),
        // `missing` never ran: the server refused it with a JSON-RPC error.
        expect.objectContaining({ tool: "x.y", outcome: "success" }),
      ]);
      // Arguments and results never leave the server.
      expect(JSON.stringify(events)).not.toContain("private");
    });
  }

  it("reads server-sent events split across chunks, with CRLF line endings", async () => {
    const encoder = new TextEncoder();
    const reply = (id: number) =>
      `event: message\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [] } })}\r\n\r\n`;
    const chunks = [
      reply(1).slice(0, 25),
      reply(1).slice(25) + reply(2).slice(0, 40),
      reply(2).slice(40),
    ];
    const handle = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    const response = await serve(post([call(1, "list_pages"), call(2, "get_context")]), handle);
    expect(await response.text()).toBe(chunks.join(""));
    await vi.waitFor(() => expect(toolEvents()).toHaveLength(2));
    expect(toolEvents().map(({ tool }) => tool)).toEqual(["list_pages", "get_context"]);
  });

  it("follows the app's base path", async () => {
    const response = await serve(
      post(call(1, "list_pages"), { path: "/docs-site/mcp" }),
      docsMCP().handle,
      "/docs-site",
    );
    await response.arrayBuffer();
    await vi.waitFor(() => expect(toolEvents()).toHaveLength(1));
  });

  it("credits a call the docs runtime answers at an alias of its endpoint to its one server", async () => {
    cleanup.splice(0, 1)[0]!();
    cleanup.unshift(
      registerFarmMCPServer({ name: "Farm.js Docs", version: "0.2.145", path: "/api/docs/mcp" }),
    );
    for (const path of ["/mcp", "/.well-known/mcp"]) {
      const response = await serve(post(call(1, "list_pages"), { path }), docsMCP().handle);
      await response.arrayBuffer();
    }
    await vi.waitFor(() => expect(toolEvents()).toHaveLength(2));
    expect(toolEvents()).toEqual([
      expect.objectContaining({ server: "Farm.js Docs", route: "/api/docs/mcp" }),
      expect.objectContaining({ server: "Farm.js Docs", route: "/api/docs/mcp" }),
    ]);
    // Another POST the handler answers, without a result for the call, reports nothing.
    const feedback = await serve(
      post(call(9, "list_pages"), { path: "/api/docs/feedback" }),
      async () => Response.json({ ok: true }),
    );
    await feedback.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toolEvents()).toHaveLength(2);
  });

  it("observes nothing else, and leaves those requests and responses as they were", async () => {
    const { handle } = docsMCP();
    cleanup.push(
      registerFarmMCPServer({ name: "remote", version: "1.0.0", url: "https://mcp.example/mcp" }),
      // With two servers in the app, a path neither registered is neither's.
      registerFarmMCPServer({ name: "agent", version: "1.0.0", path: "/agent/mcp" }),
    );
    const unobserved = [
      new Request("https://farmjs.dev/mcp"),
      post(call(1, "list_pages"), { path: "/api/mcp" }),
      post(call(1, "list_pages"), { type: "text/plain" }),
      post({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      post({ jsonrpc: "2.0", method: "tools/call", params: { name: "list_pages" } }),
      post(call(1, "not a tool name")),
      post("{not json"),
      post(JSON.stringify(call(1, "list_pages")).padEnd(1024 * 1024 + 1)),
    ];
    for (const request of unobserved) {
      expect(await _readFarmRegisteredMCPCalls(request, undefined)).toBeUndefined();
    }
    // A request that was read keeps its body for the handler.
    const read = post(call(1, "list_pages"));
    expect(await _readFarmRegisteredMCPCalls(read, undefined)).toBeDefined();
    await expect(read.json()).resolves.toEqual(call(1, "list_pages"));

    const observed = await _readFarmRegisteredMCPCalls(post(call(1, "list_pages")), undefined);
    for (const response of [
      new Response("Unauthorized", { status: 401 }),
      new Response("<p>hi</p>", { headers: { "content-type": "text/html" } }),
      new Response(null, { status: 202 }),
    ]) {
      expect(_observeFarmRegisteredMCPResponse(response, observed)).toBe(response);
    }
    const unread = (await handle(post(call(1, "a"))))!;
    expect(_observeFarmRegisteredMCPResponse(unread, undefined)).toBe(unread);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toolEvents()).toEqual([]);
  });

  it("keeps a serverless function alive until the response was read", async () => {
    const waited: Promise<unknown>[] = [];
    const observed = await _readFarmRegisteredMCPCalls(post(call(1, "list_pages")), undefined);
    const response = _observeFarmRegisteredMCPResponse(
      (await docsMCP().handle(post(call(1, "list_pages"))))!,
      observed,
      (promise) => waited.push(promise),
    );
    expect(waited).toHaveLength(1);
    await response.text();
    await waited[0];
    expect(toolEvents()).toHaveLength(1);
  });
});

describe("a docs runtime's MCP server in the manifest", () => {
  const manifestRequest = new Request("https://farmjs.dev/.well-known/farmjs.json");

  it("lists the tools it lists to an anonymous client, across pages", async () => {
    const pages: (string | undefined)[] = [];
    const handle = async (request: Request) => {
      const { id, params } = (await request.json()) as Message;
      pages.push(params?.cursor);
      const result = params?.cursor
        ? { tools: [TOOLS[1], { name: "bad name" }, TOOLS[0]] }
        : { tools: [TOOLS[0]], nextCursor: "page-2" };
      return Response.json({ jsonrpc: "2.0", id, result });
    };
    const servers = await _listFarmRegisteredMCPServerTools(handle, manifestRequest, {
      basePath: undefined,
    });
    expect(pages).toEqual([undefined, "page-2"]);
    expect(servers).toEqual([
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
            description: "List the known documentation pages.",
            // Standalone tools with no endpoint behind them, like the default server's.
            source: "defineTool",
            readOnlyHint: true,
            inputSchema: TOOLS[0]!.inputSchema,
            outputSchema: { type: "object" },
          },
          { name: "get_context", title: "Get context", source: "defineTool", openWorldHint: false },
        ],
      },
    ]);
  });

  it("asks over server-sent events at the base path", async () => {
    const urls: string[] = [];
    const { handle } = docsMCP({ eventStream: true });
    const servers = await _listFarmRegisteredMCPServerTools(
      async (request) => {
        urls.push(request.url);
        return handle(request);
      },
      new Request("https://farmjs.dev/site/.well-known/farmjs.json"),
      { basePath: "/site" },
    );
    expect(urls).toEqual(["https://farmjs.dev/site/mcp"]);
    expect(servers[0]!.tools.map(({ name }) => name)).toEqual(["list_pages", "get_context"]);
  });

  it("leaves out a field the manifest can't carry, never the tool", async () => {
    const handle = async (request: Request) => {
      const { id } = (await request.json()) as Message;
      let deep: Record<string, unknown> = {};
      const root = deep;
      for (let level = 0; level < 40; level++) deep = deep.next = {};
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "big",
              title: "Line one\nline two",
              description: "d".repeat(2001),
              inputSchema: root,
              outputSchema: { type: "object", description: "o".repeat(70 * 1024) },
            },
          ],
        },
      });
    };
    const [server] = await _listFarmRegisteredMCPServerTools(handle, manifestRequest, {
      basePath: undefined,
    });
    expect(server!.tools).toEqual([{ name: "big", source: "defineTool" }]);
  });

  it("lists a guarded or refusing server by identity only, and leaves out one that doesn't answer", async () => {
    const handle = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    const guarded = await _listFarmRegisteredMCPServerTools(handle, manifestRequest, {
      basePath: undefined,
      guardCoversPath: (path) => path === "/mcp",
    });
    expect(handle).not.toHaveBeenCalled();
    expect(guarded).toEqual([expect.objectContaining({ authorization: "required", tools: [] })]);
    const refusing = await _listFarmRegisteredMCPServerTools(handle, manifestRequest, {
      basePath: undefined,
    });
    expect(refusing).toEqual([expect.objectContaining({ authorization: "required", tools: [] })]);

    for (const answer of [
      async () => null,
      async () => new Response("Boom", { status: 500 }),
      async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601 } }),
      async () => {
        throw new Error("Boom");
      },
    ]) {
      expect(
        await _listFarmRegisteredMCPServerTools(answer, manifestRequest, { basePath: undefined }),
      ).toEqual([]);
    }
  });

  it("leaves out a server the manifest can't name, so Farm Infra still reads the rest", async () => {
    cleanup.push(
      registerFarmMCPServer({ name: "tilde", version: "1.0.0", path: "/mcp~beta" }),
      registerFarmMCPServer({ name: "n".repeat(129), version: "1.0.0", path: "/long/mcp" }),
    );
    const servers = await _listFarmRegisteredMCPServerTools(docsMCP().handle, manifestRequest, {
      basePath: undefined,
    });
    expect(servers.map(({ name }) => name)).toEqual(["dev.farmjs/docs"]);
  });

  it("gives up on a server that hasn't answered in five seconds", async () => {
    vi.useFakeTimers();
    try {
      const listing = _listFarmRegisteredMCPServerTools(
        (request) =>
          new Promise((_, reject) =>
            request.signal.addEventListener("abort", () => reject(request.signal.reason)),
          ),
        manifestRequest,
        { basePath: undefined },
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(listing).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a production server's tools once, but asks again after a failure", async () => {
    const { handle } = docsMCP();
    const counted = vi.fn(handle);
    const options = { basePath: undefined, cache: true };
    await _listFarmRegisteredMCPServerTools(counted, manifestRequest, options);
    await _listFarmRegisteredMCPServerTools(counted, manifestRequest, options);
    expect(counted).toHaveBeenCalledTimes(1);
    // Development reads them on each request.
    await _listFarmRegisteredMCPServerTools(counted, manifestRequest, { basePath: undefined });
    expect(counted).toHaveBeenCalledTimes(2);

    cleanup.push(registerFarmMCPServer({ name: "agent", version: "1.0.0", path: "/agent/mcp" }));
    const failing = vi.fn(async () => new Response("Boom", { status: 500 }));
    await _listFarmRegisteredMCPServerTools(failing, manifestRequest, options);
    await _listFarmRegisteredMCPServerTools(failing, manifestRequest, options);
    // The docs server keeps its listing; the one that failed is asked each time.
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("serves them in /.well-known/farmjs.json beside @farm.js/mcp's, hidden like them", async () => {
    const docs: FarmAppManifestServer = {
      name: "dev.farmjs/docs",
      version: "0.2.145",
      path: "/mcp",
      authorization: "none",
      resources: [],
      prompts: [],
      tools: [
        { name: "list_pages", source: "defineTool", inputSchema: { type: "object" } },
        { name: "get_context", source: "defineTool" },
      ],
    };
    cleanup.push(
      _publishFarmMCPCatalog({ name: "store", version: "1.0.0", path: "/api/mcp" }, [], {
        public: true,
      }),
    );
    const read = async (manifest: unknown, registered: FarmAppManifestServer[]) => {
      const response = await createFarmAppManifestResponse(manifestRequest, {
        ...resolveFarmAppManifestInput({ agent: { manifest } }, { build: "abc", packages: {} }),
        registeredMCP: async () => registered,
      });
      return (await response.json()).mcp;
    };
    expect((await read(undefined, [docs])).servers.map(({ name }: any) => name)).toEqual([
      "store",
      "dev.farmjs/docs",
    ]);
    // A server @farm.js/mcp mounts at the same path is the one listed.
    expect(
      (await read(undefined, [{ ...docs, path: "/api/mcp" }])).servers.map(({ name }: any) => name),
    ).toEqual(["store"]);
    const hidden = await read({ mcp: { hide: ["dev.farmjs/docs/get_context"], schemas: false } }, [
      docs,
    ]);
    expect(hidden.servers[1].tools).toEqual([{ name: "list_pages", source: "defineTool" }]);
    expect(await read({ mcp: false }, [docs])).toBeNull();

    // A failing docs runtime never keeps the manifest from answering.
    const response = await createFarmAppManifestResponse(manifestRequest, {
      ...resolveFarmAppManifestInput({}, { build: "abc", packages: {} }),
      registeredMCP: async () => {
        throw new Error("Boom");
      },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).mcp.servers.map(({ name }: any) => name)).toEqual(["store"]);
  });
});
