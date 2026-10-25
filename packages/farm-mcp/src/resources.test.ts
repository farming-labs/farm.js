// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createEndpoint } from "@farm.js/core/api";
import { invokeAPIRouteEndpoint, mergePluginAPIRoutes } from "@farm.js/core/api/runtime";
import type { FarmMCPConfig } from "@farm.js/core";
import { apiMcp, definePrompt, defineResource } from "./index.js";

function mount(config: FarmMCPConfig) {
  // An endpoint without MCP metadata: the server has no tools, only resources and prompts.
  const api = createEndpoint("/api/projects", { method: "GET" }, () => ({ source: "endpoint" }));
  const routes = mergePluginAPIRoutes(
    [{ path: "/api/projects", methods: ["GET"], endpoints: { GET: api } }],
    [apiMcp(config)],
  );
  return routes.find((route) => route.path === "/api/mcp")!.endpoints.POST;
}

async function call(endpoint: any, method: string, params?: unknown, token = "reader") {
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
  return { response, payload: data ? JSON.parse(data) : undefined };
}

const notes: Record<string, string> = { "1": "First note", "2": "Second note" };

const handbook = defineResource({
  name: "handbook",
  uri: "docs://handbook",
  title: "Handbook",
  description: "How the team works.",
  mimeType: "text/markdown",
  read: ({ authorization }) => `# Handbook\n\nRead by ${authorization.subject}.`,
});
const note = defineResource({
  name: "note",
  uriTemplate: "notes://{id}",
  description: "One note.",
  list: () => [
    { uri: "notes://1", name: "First" },
    { uri: "notes://2", name: "Second" },
  ],
  read: ({ variables }) => {
    const text = notes[String(variables.id)];
    return text === undefined
      ? null
      : [{ text, mimeType: "text/plain" }, { json: { id: variables.id } }];
  },
});
const logo = defineResource({
  name: "logo",
  uri: "assets://logo",
  read: () => ({ blob: new Uint8Array([1, 2, 255]), mimeType: "image/png" }),
});
const summarize = definePrompt({
  name: "summarize_note",
  title: "Summarize a note",
  description: "Summarize one note.",
  arguments: z.object({ id: z.string().min(1), tone: z.string().default("plain") }),
  render: ({ id, tone }) => `Summarize note ${id} in a ${tone} tone.`,
});
const greet = definePrompt({
  name: "greet",
  render: (_args, { authorization }) => [
    { role: "user", text: "Say hello." },
    { role: "assistant", text: `Hello, ${authorization.subject}.` },
  ],
});

const authorize: NonNullable<FarmMCPConfig["authorize"]> = ({ request }) => ({
  subject: request.headers.get("authorization")!.slice(7),
});

describe("MCP resources", () => {
  it("lists fixed resources and templated listings, and reads text, JSON, and binary", async () => {
    const endpoint = mount({ resources: [handbook, note, logo], authorize });

    const { payload: list } = await call(endpoint, "resources/list");
    expect(list.result.resources.map((resource: any) => [resource.uri, resource.name])).toEqual([
      ["docs://handbook", "handbook"],
      ["assets://logo", "logo"],
      ["notes://1", "First"],
      ["notes://2", "Second"],
    ]);
    const { payload: templates } = await call(endpoint, "resources/templates/list");
    expect(templates.result.resourceTemplates).toEqual([
      expect.objectContaining({
        name: "note",
        uriTemplate: "notes://{id}",
        description: "One note.",
      }),
    ]);

    const { payload: read } = await call(endpoint, "resources/read", { uri: "docs://handbook" });
    expect(read.result.contents).toEqual([
      { uri: "docs://handbook", mimeType: "text/markdown", text: "# Handbook\n\nRead by reader." },
    ]);
    const { payload: templated } = await call(endpoint, "resources/read", { uri: "notes://2" });
    expect(templated.result.contents).toEqual([
      { uri: "notes://2", mimeType: "text/plain", text: "Second note" },
      { uri: "notes://2", mimeType: "application/json", text: '{"id":"2"}' },
    ]);
    const { payload: binary } = await call(endpoint, "resources/read", { uri: "assets://logo" });
    expect(binary.result.contents).toEqual([
      { uri: "assets://logo", mimeType: "image/png", blob: "AQL/" },
    ]);
  });

  it("answers a missing resource as not found and hides unexpected errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = defineResource({
      name: "broken",
      uri: "docs://broken",
      read: () => {
        throw new Error("database password is hunter2");
      },
    });
    const endpoint = mount({ resources: [note, broken], authorize });

    const { payload: missing } = await call(endpoint, "resources/read", { uri: "notes://9" });
    expect(missing.error.message).toContain("notes://9");
    const { payload: failed } = await call(endpoint, "resources/read", { uri: "docs://broken" });
    expect(failed.error.message).toContain("Farm MCP resource read failed.");
    expect(JSON.stringify(failed)).not.toContain("hunter2");
    expect(error).toHaveBeenCalledWith(
      '[Farm.js] MCP resource "broken" failed:',
      expect.any(Error),
    );
    error.mockRestore();
  });
});

describe("MCP prompts", () => {
  it("lists prompts with their arguments and renders text or messages", async () => {
    const endpoint = mount({ prompts: [summarize, greet], authorize });

    const { payload: list } = await call(endpoint, "prompts/list");
    expect(list.result.prompts).toEqual([
      expect.objectContaining({
        name: "summarize_note",
        title: "Summarize a note",
        arguments: [
          expect.objectContaining({ name: "id", required: true }),
          expect.objectContaining({ name: "tone" }),
        ],
      }),
      expect.objectContaining({ name: "greet" }),
    ]);

    const { payload: rendered } = await call(endpoint, "prompts/get", {
      name: "summarize_note",
      arguments: { id: "7" },
    });
    expect(rendered.result).toEqual({
      description: "Summarize one note.",
      messages: [
        { role: "user", content: { type: "text", text: "Summarize note 7 in a plain tone." } },
      ],
    });
    const { payload: conversation } = await call(endpoint, "prompts/get", { name: "greet" });
    expect(conversation.result.messages).toEqual([
      { role: "user", content: { type: "text", text: "Say hello." } },
      { role: "assistant", content: { type: "text", text: "Hello, reader." } },
    ]);
  });

  it("returns argument errors and hides render errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = definePrompt({
      name: "failing",
      render: () => {
        throw new Error("secret detail");
      },
    });
    const endpoint = mount({ prompts: [summarize, failing], authorize });

    const { payload: invalid } = await call(endpoint, "prompts/get", {
      name: "summarize_note",
      arguments: { id: "" },
    });
    expect(invalid.error).toBeDefined();
    const { payload: failed } = await call(endpoint, "prompts/get", { name: "failing" });
    expect(failed.error.message).toContain("Farm MCP prompt failed.");
    expect(JSON.stringify(failed)).not.toContain("secret detail");
    error.mockRestore();
  });
});

describe("MCP resource and prompt authorization", () => {
  it("passes the requested target to authorize and applies per-caller allowlists", async () => {
    const policy = vi.fn<NonNullable<FarmMCPConfig["authorize"]>>(({ request }) =>
      request.headers.get("authorization") === "Bearer reader"
        ? { subject: "reader", resources: ["handbook"], prompts: [] }
        : { subject: "admin" },
    );
    const endpoint = mount({
      resources: [handbook, note],
      prompts: [summarize],
      authorize: policy,
    });

    const { payload: readerList } = await call(endpoint, "resources/list");
    expect(readerList.result.resources.map((resource: any) => resource.name)).toEqual(["handbook"]);
    const { payload: hidden } = await call(endpoint, "resources/read", { uri: "notes://1" });
    expect(hidden.error).toBeDefined();
    const { payload: noPrompts } = await call(endpoint, "prompts/get", {
      name: "summarize_note",
      arguments: { id: "1" },
    });
    expect(noPrompts.error).toBeDefined();
    expect(policy).toHaveBeenCalledWith(expect.objectContaining({ resource: "notes://1" }));
    expect(policy).toHaveBeenCalledWith(expect.objectContaining({ prompt: "summarize_note" }));

    const { payload: adminRead } = await call(
      endpoint,
      "resources/read",
      { uri: "notes://1" },
      "admin",
    );
    expect(adminRead.result.contents[0].text).toBe("First note");
  });

  it("rejects allowlists that name unknown resources or prompts", async () => {
    const endpoint = mount({
      resources: [handbook],
      authorize: () => ({ subject: "x", resources: ["nope"] }),
    });
    await expect(call(endpoint, "resources/list")).rejects.toThrow(
      "apiMcp authorize resources must be an array of configured resource names.",
    );
  });

  it("rejects definitions that cannot be served", () => {
    const read = () => "x";
    const render = () => "x";
    expect(() =>
      apiMcp({
        authorize,
        resources: [
          { name: "a", uri: "docs://a", read },
          { name: "a", uri: "docs://b", read },
        ],
      }),
    ).toThrow("duplicated");
    expect(() =>
      apiMcp({
        authorize,
        resources: [{ name: "a", uri: "docs://a", uriTemplate: "docs://{x}", read }],
      }),
    ).toThrow("either uri or uriTemplate");
    expect(() => apiMcp({ authorize, resources: [{ name: "a", uri: "not a uri", read }] })).toThrow(
      "absolute URI",
    );
    expect(() =>
      apiMcp({ authorize, resources: [{ name: "a", uri: "docs://a", list: () => [], read }] }),
    ).toThrow("uriTemplate");
    expect(() => apiMcp({ authorize, prompts: [{ name: "bad name", render }] })).toThrow(
      "valid MCP name",
    );
    expect(() =>
      apiMcp({
        authorize,
        prompts: [{ name: "count", arguments: z.object({ n: z.number() }), render }],
      }),
    ).toThrow('argument "n" must be a string');
  });
});
