// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRouteFactory } from "@farm.js/core/api";
import { invokeAPIRouteEndpoint, mergePluginAPIRoutes } from "@farm.js/core/api/runtime";
import { apiMcp, defineTool } from "./index.js";

async function call(endpoint: any, method: string, params?: unknown, signal?: AbortSignal) {
  const response = await invokeAPIRouteEndpoint(
    endpoint,
    new Request("http://farm.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal,
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

function standalone(outputSchema: any, execute: () => unknown) {
  const routes = mergePluginAPIRoutes(
    [],
    [
      apiMcp({
        allowUnauthenticated: true,
        tools: [defineTool({ name: "result", inputSchema: z.object({}), outputSchema, execute })],
      }),
    ],
  );
  return routes[0]!.endpoints.POST;
}

const invoke = (endpoint: any, name = "result") =>
  call(endpoint, "tools/call", { name, arguments: {} });

describe("MCP output schemas", () => {
  it("advertises the result envelope and validates/transforms output once", async () => {
    const refine = vi.fn(async () => true);
    const transform = vi.fn((value: string) => value.length);
    const output = z.object({
      length: z.string().refine(refine).transform(transform).pipe(z.number()),
      label: z.string().default("count"),
    });
    const endpoint = standalone(output, () => ({ length: "farm", secret: "not-public" }));
    const list = await call(endpoint, "tools/list");
    expect(list.result.tools[0].outputSchema).toMatchObject({
      type: "object",
      required: ["result"],
      properties: {
        result: {
          type: "object",
          required: ["length", "label"],
          properties: { length: { type: "number" }, label: { type: "string" } },
        },
      },
    });
    const response = await invoke(endpoint);
    expect(response.result.structuredContent).toEqual({ result: { length: 4, label: "count" } });
    expect(JSON.parse(response.result.content[0].text)).toEqual({ length: 4, label: "count" });
    expect(JSON.stringify(response)).not.toContain("not-public");
    expect(refine).toHaveBeenCalledTimes(1);
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it("fails closed for invalid outputs without exposing returned data or validator messages", async () => {
    const endpoint = standalone(
      z.object({ value: z.number() }).refine(() => false, "private-detail"),
      () => ({ value: 2, secret: "hidden" }),
    );
    const response = await invoke(endpoint);
    expect(response.result.isError).toBe(true);
    expect(response.result.structuredContent).toBeUndefined();
    expect(response.result.content[0].text).toContain("output schema");
    expect(JSON.stringify(response)).not.toMatch(/private-detail|hidden/);
  });

  it.each([
    [z.array(z.number()), [1, 2]],
    [z.number(), 42],
    [z.null(), null],
  ])(
    "supports JSON arrays, scalars, and null inside the existing envelope",
    async (schema, value) => {
      const endpoint = standalone(schema, () => value);
      const list = await call(endpoint, "tools/list");
      expect(list.result.tools[0].outputSchema).toBeDefined();
      expect((await invoke(endpoint)).result.structuredContent).toEqual({ result: value });
    },
  );

  it("keeps recursive output schema references valid after wrapping", async () => {
    const tree = z.object({
      name: z.string(),
      get children() {
        return z.array(tree);
      },
    });
    const value = { name: "root", children: [{ name: "leaf", children: [] }] };
    const endpoint = standalone(tree, () => value);
    const list = await call(endpoint, "tools/list");
    expect(list.result.tools[0].outputSchema.properties.result.properties.children.items.$ref).toBe(
      "#/properties/result",
    );
    expect((await invoke(endpoint)).result.structuredContent).toEqual({ result: value });
  });

  it("supports Standard Schema output conversion and validation", async () => {
    const validate = vi.fn(async (value: any) => ({ value: { length: value.text.length } }));
    const schema = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate,
        jsonSchema: {
          input: () => ({
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          }),
          output: () => ({
            type: "object",
            properties: { length: { type: "number" } },
            required: ["length"],
          }),
        },
      },
    };
    const endpoint = standalone(schema, () => ({ text: "farm" }));
    expect((await invoke(endpoint)).result.structuredContent).toEqual({ result: { length: 4 } });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(
      (await call(endpoint, "tools/list")).result.tools[0].outputSchema.properties.result
        .properties,
    ).toHaveProperty("length");
  });

  it("reuses endpoint output validation without running its transforms twice", async () => {
    const transform = vi.fn((value: string) => value.length);
    const route = createRouteFactory().get("/api/count", {
      mcp: true,
      output: z.object({ length: z.string().transform(transform).pipe(z.number()) }),
      handler: () => ({ length: "farm" }),
    });
    const routes = mergePluginAPIRoutes(
      [{ path: route.path, methods: [route.method], endpoints: { GET: route.endpoint } }],
      [apiMcp({ allowUnauthenticated: true })],
    );
    const endpoint = routes.find(({ path }) => path === "/api/mcp")!.endpoints.POST;
    const list = await call(endpoint, "tools/list");
    expect(list.result.tools[0].outputSchema.properties.result.properties.length.type).toBe(
      "number",
    );
    expect((await invoke(endpoint, "get_count")).result.structuredContent).toEqual({
      result: { length: 4 },
    });
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it("rejects unrepresentable output schemas at registration", () => {
    expect(() => standalone(z.date(), () => new Date())).toThrow("outputSchema");
  });

  it("rebases definition references without rewriting literal data or mutating the source", async () => {
    const json = {
      type: "object",
      $defs: { count: { type: "number" } },
      properties: {
        count: { $ref: "#/$defs/count" },
        literal: { const: { $ref: "#/$defs/count" } },
      },
      required: ["count", "literal"],
    };
    const schema = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
        jsonSchema: { output: () => json },
      },
    };
    const value = { count: 4, literal: { $ref: "#/$defs/count" } };
    const endpoint = standalone(schema, () => value);
    expect((await invoke(endpoint)).result.structuredContent).toEqual({ result: value });
    const list = await call(endpoint, "tools/list");
    const output = list.result.tools[0].outputSchema.properties.result;
    expect(output.properties.count.$ref).toBe("#/properties/result/$defs/count");
    expect(output.properties.literal.const.$ref).toBe("#/$defs/count");
    expect(json.properties.count.$ref).toBe("#/$defs/count");
  });

  it("preserves references scoped to an explicit schema resource", async () => {
    const json = {
      $id: "urn:farm:test:output",
      type: "object",
      $defs: { count: { type: "number" } },
      properties: { count: { $ref: "#/$defs/count" } },
      required: ["count"],
    };
    const schema = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
        jsonSchema: { output: () => json },
      },
    };
    const endpoint = standalone(schema, () => ({ count: 4 }));
    expect((await invoke(endpoint)).result.structuredContent).toEqual({ result: { count: 4 } });
    expect(
      (await call(endpoint, "tools/list")).result.tools[0].outputSchema.properties.result.properties
        .count.$ref,
    ).toBe("#/$defs/count");
  });

  it("checks the serialized result rather than trusting a validator's success alone", async () => {
    const schema = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => ({ value: { count: "wrong" } }),
        jsonSchema: {
          output: () => ({
            type: "object",
            properties: { count: { type: "number" } },
            required: ["count"],
          }),
        },
      },
    };
    const response = await invoke(standalone(schema, () => ({ count: 4 })));
    expect(response.result.isError).toBe(true);
    expect(response.result.structuredContent).toBeUndefined();
  });

  it.each([200, 403])(
    "handles raw endpoint responses with an output schema (HTTP %s)",
    async (status) => {
      const validate = vi.fn(() => true);
      const route = createRouteFactory().get("/api/raw", {
        mcp: true,
        output: z.object({ count: z.number() }).refine(validate),
        handler: () => Response.json({ count: "invalid" }, { status }),
      });
      const routes = mergePluginAPIRoutes(
        [{ path: route.path, methods: [route.method], endpoints: { GET: route.endpoint } }],
        [apiMcp({ allowUnauthenticated: true })],
      );
      const endpoint = routes.find(({ path }) => path === "/api/mcp")!.endpoints.POST;
      const response = await invoke(endpoint, "get_raw");
      expect(response.result.isError).toBe(true);
      expect(response.result.structuredContent).toBeUndefined();
      if (status === 403) expect(response.result.content[0].text).toContain('"status":403');
      expect(validate).not.toHaveBeenCalled();
    },
  );

  it("does not execute or validate output for a denied tool", async () => {
    const validate = vi.fn(() => true);
    const execute = vi.fn(() => ({ count: 4 }));
    const routes = mergePluginAPIRoutes(
      [],
      [
        apiMcp({
          authorize: () => ({ subject: "reader", tools: [] }),
          tools: [
            defineTool({
              name: "count",
              inputSchema: z.object({}),
              outputSchema: z.object({ count: z.number() }).refine(validate),
              execute,
            }),
          ],
        }),
      ],
    );
    const response = await invoke(routes[0]!.endpoints.POST, "count");
    expect(response.error).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect((await call(routes[0]!.endpoints.POST, "tools/list")).result.tools).toEqual([]);
  });

  it("does not return a successful result after cancellation during output validation", async () => {
    const controller = new AbortController();
    let started!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const validate = vi.fn(async () => {
      started();
      await gate;
      return true;
    });
    const execute = vi.fn(() => ({ count: 4 }));
    const endpoint = standalone(z.object({ count: z.number() }).refine(validate), execute);
    const pending = call(
      endpoint,
      "tools/call",
      { name: "result", arguments: {} },
      controller.signal,
    ).catch(() => undefined);
    await ready;
    controller.abort();
    finish();
    const response = await pending;
    expect(response?.result?.structuredContent).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it("leaves tools without an output schema unchanged", async () => {
    const endpoint = standalone(undefined, () => ({ ok: true }));
    expect((await call(endpoint, "tools/list")).result.tools[0]).not.toHaveProperty("outputSchema");
    expect((await invoke(endpoint)).result.structuredContent).toEqual({ result: { ok: true } });
  });
});
