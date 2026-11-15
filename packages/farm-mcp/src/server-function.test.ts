// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { invokeAPIRouteEndpoint, mergePluginAPIRoutes } from "@farm.js/core/api/runtime";
import { redirect } from "@farm.js/core/navigation";
import { createServerFn, createServerMiddleware } from "@farm.js/core/server-fn";
import { createServerQuery } from "@farm.js/core/server-query";
import type { FarmMCPConfig } from "@farm.js/core";
import { apiMcp } from "./index.js";

function mount(config: FarmMCPConfig) {
  const routes = mergePluginAPIRoutes([], [apiMcp(config)]);
  return routes.find((route) => route.path === "/api/mcp")!.endpoints.POST;
}

async function call(endpoint: any, method: string, params?: unknown, token = "agent") {
  const response = await invokeAPIRouteEndpoint(
    endpoint,
    new Request("http://farm.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const text = await response.text();
  const data = response.headers.get("content-type")?.startsWith("text/event-stream")
    ? text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : text;
  return JSON.parse(data!);
}

const authorize: FarmMCPConfig["authorize"] = ({ request }) => ({
  subject: request.headers.get("authorization")!.slice(7),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("server functions as MCP tools", () => {
  it("advertises actions and queries with their schemas and conservative hints", async () => {
    const submit = createServerFn({
      input: z.object({ email: z.string().email() }),
      output: z.object({ ticketId: z.string() }),
      mcp: { name: "contact_submit", description: "Send a message to sales" },
      handler: () => ({ ticketId: "t-1" }),
    });
    const plans = createServerQuery({
      key: () => ["plans"],
      mcp: { name: "list_plans" },
      handler: () => [{ name: "Pro" }],
    });
    const catalog = vi.fn<NonNullable<FarmMCPConfig["authorize"]>>(authorize);
    const endpoint = mount({ tools: [submit, plans], authorize: catalog });

    const list = await call(endpoint, "tools/list");
    const [action, query] = list.result.tools;
    expect(action.name).toBe("contact_submit");
    expect(action.description).toBe("Send a message to sales");
    expect(action.inputSchema.properties.email).toMatchObject({ type: "string" });
    expect(action.outputSchema.properties.result.properties).toHaveProperty("ticketId");
    expect(action.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(query.name).toBe("list_plans");
    expect(query.inputSchema).toMatchObject({ type: "object", properties: {} });
    expect(query.annotations).toMatchObject({ readOnlyHint: true });

    const tools = catalog.mock.calls[0]![0].tools;
    expect(tools.map(({ kind }) => kind)).toEqual(["serverFunction", "serverFunction"]);
    expect(tools[0]).not.toHaveProperty("handler");
    expect(tools[0]).not.toHaveProperty("path");
  });

  it("runs input schema, middleware, handler, output and invalidations once, with the MCP request", async () => {
    const refine = vi.fn((value: string) => value !== "blocked");
    const transform = vi.fn((value: string) => value.toUpperCase());
    const invalidates = vi.fn(() => []);
    const auth = createServerMiddleware({
      handler: ({ request, next }) =>
        next({ context: { credential: request?.headers.get("authorization") ?? null } }),
    });
    const handler = vi.fn(({ input, context }) => ({
      code: input.code,
      credential: context.credential,
    }));
    const redeem = createServerFn({
      input: z.object({ code: z.string().refine(refine).transform(transform) }),
      middleware: [auth],
      invalidates,
      mcp: { name: "redeem_code" },
      handler,
    });
    const endpoint = mount({ tools: [redeem], authorize });

    const result = await call(endpoint, "tools/call", {
      name: "redeem_code",
      arguments: { code: "farm" },
    });

    expect(result.result.isError).toBeFalsy();
    expect(result.result.structuredContent).toEqual({
      result: { code: "FARM", credential: "Bearer agent" },
    });
    expect(refine).toHaveBeenCalledTimes(1);
    expect(transform).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(invalidates).toHaveBeenCalledTimes(1);
  });

  it("returns validator messages for bad arguments without running the handler", async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const submit = createServerFn({
      input: z.object({ email: z.string().email() }),
      mcp: { name: "contact_submit" },
      handler,
    });
    const endpoint = mount({ tools: [submit], authorize });

    const result = await call(endpoint, "tools/call", {
      name: "contact_submit",
      arguments: { email: "not-an-email" },
    });

    expect(result.result.isError).toBe(true);
    expect(result.result.content[0].text).toMatch(/email/i);
    expect(handler).not.toHaveBeenCalled();
  });

  it("hides an exception thrown inside an input refinement", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn(() => ({ ok: true }));
    const claim = createServerFn({
      input: z.object({ slug: z.string() }).refine(() => {
        throw new Error("connect postgres://admin:hunter2@db.internal failed");
      }),
      mcp: { name: "claim_slug" },
      handler,
    });
    const endpoint = mount({ tools: [claim], authorize });

    const result = await call(endpoint, "tools/call", {
      name: "claim_slug",
      arguments: { slug: "farm" },
    });

    expect(result.result.isError).toBe(true);
    expect(result.result.content[0].text).toBe("Server function failed.");
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns declared failures and redirects, and hides undeclared errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const book = createServerFn({
      input: z.object({ seat: z.string() }),
      errors: { SOLD_OUT: { status: 409, data: z.object({ seat: z.string() }) } },
      mcp: { name: "book_seat" },
      handler: ({ input, error }) => {
        if (input.seat === "taken") error("SOLD_OUT", { seat: input.seat });
        if (input.seat === "moved") redirect("/seats/new");
        throw new Error("database password is hunter2");
      },
    });
    const endpoint = mount({ tools: [book], authorize });
    const run = async (seat: string) =>
      (await call(endpoint, "tools/call", { name: "book_seat", arguments: { seat } })).result;

    const declared = await run("taken");
    expect(declared.isError).toBe(true);
    expect(JSON.parse(declared.content[0].text)).toEqual({
      error: {
        code: "SOLD_OUT",
        status: 409,
        message: "Server function failed",
        data: { seat: "taken" },
      },
    });

    const moved = await run("moved");
    expect(moved.isError).toBe(true);
    expect(JSON.parse(moved.content[0].text)).toEqual({
      redirect: { url: "/seats/new", status: 307 },
    });

    const hidden = await run("other");
    expect(hidden.isError).toBe(true);
    expect(hidden.content[0].text).toBe("Server function failed.");
    expect(JSON.stringify(hidden)).not.toContain("hunter2");
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("does not return output that fails the output schema", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky = createServerFn({
      output: z.object({ id: z.string() }),
      mcp: { name: "leaky" },
      handler: () => ({ id: 1, secret: "s3cret" }) as never,
    });
    const endpoint = mount({ tools: [leaky], authorize });

    const result = await call(endpoint, "tools/call", { name: "leaky", arguments: {} });

    expect(result.result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("s3cret");
  });

  it("returns a query's data rather than its client cache envelope", async () => {
    const plans = createServerQuery({
      input: z.object({ tier: z.string() }),
      key: ({ input }) => ["plans", input.tier],
      mcp: { name: "list_plans" },
      handler: ({ input }) => [{ name: "Pro", tier: input.tier }],
    });
    const endpoint = mount({ tools: [plans], authorize });

    const result = await call(endpoint, "tools/call", {
      name: "list_plans",
      arguments: { tier: "team" },
    });

    expect(result.result.structuredContent).toEqual({ result: [{ name: "Pro", tier: "team" }] });
  });

  it("requires a tool name and keeps names unique across tool kinds", () => {
    const unnamed = createServerFn({ handler: () => null });
    expect(() => mount({ tools: [unnamed], authorize })).toThrow(/need a tool name/);

    const first = createServerFn({ mcp: { name: "same" }, handler: () => null });
    const second = createServerQuery({
      key: () => ["k"],
      mcp: { name: "same" },
      handler: () => null,
    });
    expect(() => mount({ tools: [first, second], authorize })).toThrow(/duplicated/);
  });
});
