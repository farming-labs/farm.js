import { describe, expect, it, vi } from "vitest";
import { mergePluginAPIRoutes } from "@farm.js/core/api/runtime";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1024 * 1024 } as never,
  deploymentId: "mcp-test",
  debug: false,
};

const MCP_PATHS = ["/app/layer/farm.config.ts?farm-rsc-mcp", "/app/vite.config.ts?farm-rsc-mcp"];

type Route = {
  path: string;
  methods: string[];
  handlers: Record<string, unknown>;
  files: Record<string, string>;
  sources: Record<string, number>;
};

/** Runs the generated mcp block against an API route map, with core's real route merge. */
function mountMcp(apiRouteMap: Map<string, Route>, mcpConfigs: unknown[]) {
  const entry = generateRscEntry({ ...context, mcpConfigPaths: MCP_PATHS });
  const start = entry.indexOf("const farmNativeMCPPlugin = (() => {");
  const end = entry.indexOf("async function handleAPIRequest(request)", start);
  const createPlugin = vi.fn((config: { path?: string; name?: string }) => ({
    name: "farm:api-mcp",
    config,
    routes: ({ route }: any) => [
      route.post(config.path ?? "/api/mcp", { handler: () => new Response("mcp") }),
      route.get(config.path ?? "/api/mcp", { handler: () => new Response("mcp") }),
    ],
  }));
  new Function(
    "apiRouteMap",
    "mergePluginAPIRoutes",
    "__farmCreateMCPPlugin",
    ...mcpConfigs.map((_config, index) => `FarmMCPConfigModule${index}`),
    entry.slice(start, end),
  )(
    apiRouteMap,
    mergePluginAPIRoutes,
    createPlugin,
    ...mcpConfigs.map((config) => ({ default: { mcp: config } })),
  );
  return createPlugin;
}

function fileRoute(path: string, method: string): Route {
  return {
    path,
    methods: [method],
    handlers: { [method]: () => new Response(path) },
    files: { [method]: `/app/src/api${path}/route.ts` },
    sources: { [method]: 0 },
  };
}

describe("RSC mcp", () => {
  it("emits nothing without an mcp config", () => {
    const entry = generateRscEntry(context);
    expect(entry).not.toContain("@farm.js/mcp/internal");
    expect(entry).not.toContain("farmNativeMCPPlugin");
  });

  it("imports the mcp config slices and the MCP runtime", () => {
    const entry = generateRscEntry({ ...context, mcpConfigPaths: MCP_PATHS });
    expect(entry).toContain(
      'import * as FarmMCPConfigModule0 from "/app/layer/farm.config.ts?farm-rsc-mcp";',
    );
    expect(entry).toContain(
      'import * as FarmMCPConfigModule1 from "/app/vite.config.ts?farm-rsc-mcp";',
    );
    expect(entry).toContain('from "@farm.js/mcp/internal"');
  });

  it("mounts the endpoint next to file routes, merging layer configs", () => {
    const apiRouteMap = new Map([["/api/users", fileRoute("/api/users", "GET")]]);
    const createPlugin = mountMcp(apiRouteMap, [
      { path: "/api/agent", name: "layer" },
      { name: "project", allowUnauthenticated: true },
    ]);

    expect(createPlugin).toHaveBeenCalledTimes(1);
    expect(createPlugin.mock.calls[0]![0]).toMatchObject({ path: "/api/agent", name: "project" });
    expect(apiRouteMap.get("/api/users")!.methods).toEqual(["GET"]);
    const mcp = apiRouteMap.get("/api/agent")!;
    expect(mcp.methods.sort()).toEqual(["GET", "POST"]);
    expect(mcp.files.POST).toBe("plugin:farm:api-mcp");
  });

  it("creates nothing when a later config disables mcp", () => {
    const apiRouteMap = new Map<string, Route>();
    const createPlugin = mountMcp(apiRouteMap, [{ name: "layer" }, false]);
    expect(createPlugin).not.toHaveBeenCalled();
    expect(apiRouteMap.size).toBe(0);
  });

  it("rejects an mcp route that would replace an app endpoint", () => {
    const apiRouteMap = new Map([["/api/mcp", fileRoute("/api/mcp", "POST")]]);
    expect(() => mountMcp(apiRouteMap, [undefined, { name: "project" }])).toThrow(
      "Duplicate API route for POST /api/mcp",
    );
  });
});
