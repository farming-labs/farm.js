// @vitest-environment node
import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createIntegrationClients } from "../integration-client";
import { endpoint } from "../integration-api";
import { defineIntegration, integrationRoute, resolveIntegrationPlugins } from "../integrations";
import { PluginManager } from "../plugin";
import { _runWithCurrentRequest } from "../server/request";

const sources = {
  billing: {
    status: endpoint.get<{ tag: string[] }, { url: string }>("/api/billing/status?existing=1"),
  },
};
afterEach(() => vi.unstubAllGlobals());

it.each(["absolute", "relative", "origin", "override"])(
  "uses the same %s API root for browser calls and server HTTP fallback",
  async (mode) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ url: request.url }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");
    const origin = `http://127.0.0.1:${address.port}`;
    const baseURL =
      mode === "relative" ? "/backend/v2" : mode === "origin" ? origin : `${origin}/backend/v2/`;
    const pair = createIntegrationClients(
      sources,
      { baseURL },
      mode === "override" ? { baseURL: `${origin}/unused` } : undefined,
    );
    const input = { query: { tag: ["first", "a/b"] } };
    const expected = `${mode === "origin" ? "/api" : "/backend/v2"}/billing/status?existing=1&tag=first&tag=a%2Fb`;
    try {
      vi.stubGlobal("window", { location: { origin } });
      const browser = await pair.apiClient.billing.status(input);
      expect(browser.error).toBeNull();
      expect(browser.data?.url).toBe(expected);
      vi.stubGlobal("window", undefined);
      const result = await _runWithCurrentRequest(new Request(`${origin}/page`), () =>
        pair.api.billing.status(input, mode === "override" ? { baseURL } : undefined),
      );
      expect(result.error).toBeNull();
      expect(result.data?.url).toBe(expected);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

it.each([true, false])("keeps registered dispatch canonical in development=%s", async (isDev) => {
  const handler = vi.fn((request: Request) =>
    Response.json({ path: new URL(request.url).pathname }),
  );
  const integration = defineIntegration({
    category: "custom",
    type: "base-url-test",
    instance: {},
    routes: [integrationRoute.get("/api/base-url-test/status", { handler })],
  });
  const integrations = { baseUrlTest: integration };
  const manager = new PluginManager({ config: { integrations } as any, isDev, isProd: !isDev });
  manager.addPlugins(resolveIntegrationPlugins(integrations));
  const http = vi.fn(async () => {
    throw new Error("Must stay local");
  });
  try {
    await manager.runHookParallel("init");
    const pair = createIntegrationClients(integrations, {
      baseURL: "https://gateway.test/backend/v2",
      fetch: http,
    });
    const result = await _runWithCurrentRequest(new Request("https://farm.test/page"), () =>
      pair.api.baseUrlTest.status(),
    );
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ path: "/api/base-url-test/status" });
    expect(handler).toHaveBeenCalledOnce();
    expect(http).not.toHaveBeenCalled();
  } finally {
    await manager.closeRuntime();
  }
});
