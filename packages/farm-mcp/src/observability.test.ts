// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createEndpoint } from "@farm.js/core/api";
import { invokeAPIRouteEndpoint, mergePluginAPIRoutes } from "@farm.js/core/api/runtime";
import {
  configureFarmObservability,
  onFarmEvent,
  resetFarmObservability,
  type FarmEvent,
} from "@farm.js/core/observability";
import { apiMcp, defineTool } from "./index.js";

beforeEach(() => resetFarmObservability());
afterEach(() => {
  resetFarmObservability();
  vi.restoreAllMocks();
});

function mount() {
  const endpoint = createEndpoint("/api/private/[id]", { method: "GET" }, () =>
    Response.json({ secret: "private-response" }, { status: 503 }),
  );
  const routes = mergePluginAPIRoutes(
    [{ path: "/api/private/[id]", methods: ["GET"], endpoints: { GET: endpoint } }],
    [
      apiMcp({
        name: "workspace",
        path: "/api/tools",
        authorize: ({ request }) =>
          request.headers.get("authorization") === "Bearer private-credential"
            ? {
                subject: "private-subject",
                tools: ["good", "throws", "invalid", "refines", "read"],
              }
            : false,
        tools: [
          defineTool({
            name: "good",
            inputSchema: z.object({ secret: z.string() }),
            // An application's isError property is data, not an MCP error envelope.
            execute: async () => ({ isError: true, secret: "private-result" }),
          }),
          defineTool({
            name: "throws",
            inputSchema: z.object({}),
            execute: () => {
              throw new Error("private-exception");
            },
          }),
          defineTool({
            name: "invalid",
            inputSchema: z.object({}),
            outputSchema: z.object({ count: z.number() }),
            execute: () => ({ count: "private-invalid-output" }),
          }),
          defineTool({
            name: "refines",
            inputSchema: z.object({ secret: z.string().refine(async () => false) }),
            execute: () => {
              throw new Error("must not run");
            },
          }),
          { endpoint, name: "read" },
          defineTool({ name: "hidden", inputSchema: z.object({}), execute: () => null }),
        ],
      }),
    ],
  );
  return routes.find((route) => route.path === "/api/tools")!.endpoints.POST;
}

async function call(endpoint: any, name: string, args: unknown = {}, token = "private-credential") {
  const response = await invokeAPIRouteEndpoint(
    endpoint,
    new Request("http://farm.test/api/tools?private-query=secret", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
        authorization: `Bearer ${token}`,
        cookie: "private-cookie",
        "user-agent": "private-agent",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "private-rpc-id",
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const text = await response.text();
  const data = response.headers.get("content-type")?.startsWith("text/event-stream")
    ? text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : text;
  return { response, body: data ? JSON.parse(data) : undefined };
}

describe("MCP completion events", () => {
  it("reports actual endpoint and standalone results without payloads or credentials", async () => {
    const events: FarmEvent[] = [];
    onFarmEvent((event) => {
      if (event.type === "mcp.tool.complete") events.push(event);
    });
    const endpoint = mount();
    const success = await call(endpoint, "good", { secret: "private-input" });
    expect(success.response.status).toBe(200);
    expect(success.body.result.structuredContent.result.isError).toBe(true);
    for (const [name, args] of [
      ["throws", {}],
      ["invalid", {}],
      ["refines", { secret: "private-input" }],
      ["read", { params: { id: "private-route-value" } }],
    ] as const) {
      const result = await call(endpoint, name, args);
      expect(result.response.status).toBe(200);
      expect(result.body.result.isError).toBe(true);
    }
    expect(events).toHaveLength(5);
    for (const [index, tool] of ["good", "throws", "invalid", "refines", "read"].entries()) {
      expect(events[index]).toEqual({
        type: "mcp.tool.complete",
        timestamp: expect.any(Number),
        level: index === 0 ? "info" : "error",
        route: "/api/tools",
        server: "workspace",
        tool,
        outcome: index === 0 ? "success" : "error",
        durationMs: expect.any(Number),
      });
      expect((events[index] as any).durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(JSON.stringify(events)).not.toContain("private-");
  });

  it("does not label authorization, hidden tools or SDK input rejection as executed tools", async () => {
    const events: FarmEvent[] = [];
    onFarmEvent((event) => {
      if (event.type === "mcp.tool.complete") events.push(event);
    });
    const endpoint = mount();
    expect((await call(endpoint, "good", {}, "wrong")).response.status).toBe(401);
    expect((await call(endpoint, "hidden")).body.error).toBeDefined();
    expect((await call(endpoint, "unknown")).body.error).toBeDefined();
    expect((await call(endpoint, "good", { secret: 1 })).body.result.isError).toBe(true);
    expect(events).toEqual([]);
  });

  it("uses the existing filtered event bus and unsubscribe lifecycle", async () => {
    const configured = vi.fn();
    const listener = vi.fn();
    configureFarmObservability({ events: ["mcp.tool.complete"], onEvent: configured });
    const dispose = onFarmEvent(listener);
    const endpoint = mount();
    await call(endpoint, "good", { secret: "private-input" });
    expect(configured).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
    await call(endpoint, "good", { secret: "private-input" });
    expect(configured).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
    configureFarmObservability({ events: ["request.complete"], onEvent: configured });
    await call(endpoint, "good", { secret: "private-input" });
    expect(configured).toHaveBeenCalledTimes(2);
  });

  it("does not change tool results when an event subscriber fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    onFarmEvent(() => {
      throw new Error("observer failure");
    });
    onFarmEvent(async () => {
      throw new Error("async observer failure");
    });
    const result = await call(mount(), "good", { secret: "private-input" });
    expect(result.body.result.structuredContent.result.secret).toBe("private-result");
    expect(warning).toHaveBeenCalledTimes(2);
  });
});
