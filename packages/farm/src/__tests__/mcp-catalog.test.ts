// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import type { FarmMCPTool } from "../mcp-config";
import { createMarkdownMirrorResponse, resolveMarkdownConfig } from "../markdown";
import { _findFarmMCPEndpointTool, _publishFarmMCPCatalog } from "../mcp-catalog";

const server = { name: "farm-api", version: "1.0.0", path: "/api/mcp" as const };
const tools: FarmMCPTool[] = [
  { kind: "endpoint", name: "contact_submit", method: "POST", path: "/api/contact" },
  { kind: "endpoint", name: "list_projects", method: "GET", path: "/api/projects/[team]" },
  { kind: "standalone", name: "search" },
];

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const publish = (...args: Parameters<typeof _publishFarmMCPCatalog>) => {
  cleanups.push(_publishFarmMCPCatalog(...args));
};

describe("MCP catalog", () => {
  it("finds the tool behind an endpoint by method and route pattern", () => {
    publish(server, tools);
    expect(_findFarmMCPEndpointTool("post", "/api/contact")).toEqual({
      name: "contact_submit",
      endpoint: "/api/mcp",
    });
    expect(_findFarmMCPEndpointTool("GET", "/api/projects/team-a")?.name).toBe("list_projects");
    // Same path, other method; unknown paths; standalone tools have no endpoint.
    expect(_findFarmMCPEndpointTool("GET", "/api/contact")).toBeUndefined();
    expect(_findFarmMCPEndpointTool("POST", "/api/other")).toBeUndefined();
    expect(_findFarmMCPEndpointTool("POST", "/search")).toBeUndefined();
  });

  it("maps a public API path to the canonical /api routes and back", () => {
    publish(server, tools);
    expect(_findFarmMCPEndpointTool("POST", "/v1/contact", "/v1")).toEqual({
      name: "contact_submit",
      endpoint: "/v1/mcp",
    });
  });

  it("replaces a catalog for the same endpoint, keeps others, and unpublishes", () => {
    const remove = _publishFarmMCPCatalog(server, tools);
    _publishFarmMCPCatalog(server, [
      { kind: "endpoint", name: "contact_v2", method: "POST", path: "/api/contact" },
    ]);
    publish({ ...server, path: "/api/tools" }, [
      { kind: "endpoint", name: "upload", method: "POST", path: "/api/upload" },
    ]);
    expect(_findFarmMCPEndpointTool("POST", "/api/contact")?.name).toBe("contact_v2");
    // Removing the replaced catalog leaves the current one in place.
    remove();
    expect(_findFarmMCPEndpointTool("POST", "/api/contact")?.name).toBe("contact_v2");
    expect(_findFarmMCPEndpointTool("POST", "/api/upload")).toEqual({
      name: "upload",
      endpoint: "/api/tools",
    });
    cleanups.push(_publishFarmMCPCatalog(server, []));
  });
});

describe("Markdown mirror actions with MCP tools", () => {
  const page = `<html><body><main><h1>Contact</h1>
    <form method="post" action="/api/contact"><input name="email" type="email" required><button>Send</button></form>
    <form method="get" action="/api/projects/team-a"><button>List</button></form>
    <form method="post" action="https://elsewhere.test/api/contact"><input name="x"><button>Go</button></form>
    <form method="post"><input name="y"><button>Self</button></form>
  </main></body></html>`;

  it("names the MCP tool that runs a form's API endpoint", async () => {
    publish(server, tools);
    const response = await createMarkdownMirrorResponse({
      request: new Request("https://acme.test/contact.md?actions"),
      config: resolveMarkdownConfig({ expose: ["/contact"] }),
      renderPage: async () =>
        new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    });
    const { actions } = await response!.json();
    expect(actions.map((form: any) => form.tool)).toEqual([
      { name: "contact_submit", endpoint: "/api/mcp" },
      { name: "list_projects", endpoint: "/api/mcp" },
      undefined,
      undefined,
    ]);
  });

  it("names no tool when no MCP server is running", async () => {
    const response = await createMarkdownMirrorResponse({
      request: new Request("https://acme.test/contact.md?actions"),
      config: resolveMarkdownConfig({ expose: ["/contact"] }),
      renderPage: async () =>
        new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    });
    const { actions } = await response!.json();
    expect(actions.every((form: any) => form.tool === undefined)).toBe(true);
  });
});
