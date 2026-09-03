// @vitest-environment node

import { createServer } from "node:http";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyAgentRuntimeViteProxy,
  createAgentRuntimeIntegration,
  findAvailableAgentRuntimePort,
  normalizeAgentOrigin,
  normalizeAgentRoutePrefix,
  proxyAgentRuntimeRequest,
  resolveProjectPackageBin,
  startManagedAgentRuntime,
  type FarmManagedAgentRuntime,
} from "../agent-runtime";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("agent runtime integration", () => {
  it("starts a managed runtime, mounts a raw route, and adds a WebSocket proxy", async () => {
    let stopped = false;
    const managed: FarmManagedAgentRuntime = {
      origin: "http://127.0.0.1:43111",
      async stop() {
        stopped = true;
      },
    };
    const integration = createAgentRuntimeIntegration({
      provider: "test-agent",
      routePrefix: "/agents",
      additionalRoutePrefixes: ["/.well-known/agent"],
      webSockets: true,
      async startDev() {
        return managed;
      },
    });
    const lifecycleCleanups: Array<() => Promise<void> | void> = [];

    await integration.setup?.({
      appConfig: { root: process.cwd() },
      config: { root: process.cwd() },
      env: {},
      integration,
      integrationConfig: undefined,
      isDev: true,
      isProd: false,
      key: "agent",
      log: { info() {}, warn() {}, error() {} },
      args: {} as never,
      async cleanup(callback?: () => Promise<void> | void) {
        if (callback) lifecycleCleanups.push(callback);
      },
    });

    const config: { vite?: Record<string, any> } = {};
    await integration.plugins?.[0]?.config?.(config, {
      config,
      isDev: true,
      isProd: false,
      requestContext: {} as never,
    });

    expect(integration.category).toBe("agent");
    expect(integration.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/agents/[...farmAgentRuntimePath]",
          rawBody: true,
        }),
        expect.objectContaining({
          path: "/.well-known/agent/[...farmAgentRuntimePath]",
          rawBody: true,
        }),
      ]),
    );
    expect(config.vite?.server.proxy["/agents"]).toEqual({
      target: managed.origin,
      changeOrigin: true,
      ws: true,
    });
    expect(config.vite?.server.proxy["/.well-known/agent"]).toEqual({
      target: managed.origin,
      changeOrigin: true,
      ws: true,
    });

    await Promise.all(lifecycleCleanups.map((cleanup) => cleanup()));
    expect(stopped).toBe(true);
  });

  it("rejects a Vite proxy collision", () => {
    const config = {
      vite: {
        server: {
          proxy: {
            "/agents": { target: "http://elsewhere.test" },
          },
        },
      },
    };

    expect(() =>
      applyAgentRuntimeViteProxy(config, {
        origin: "http://127.0.0.1:8787",
        routePrefix: "/agents",
      }),
    ).toThrow("already defines it");
  });
});

describe("agent runtime proxy", () => {
  it("removes headers named by Connection in both proxy directions", async () => {
    let forwardedHeaders: Headers | undefined;
    const response = await proxyAgentRuntimeRequest(
      new Request("https://farm.test/agents/demo", {
        headers: {
          connection: "keep-alive, x-request-hop",
          "x-request-hop": "request-only",
          "x-end-to-end": "preserved",
        },
      }),
      "https://agent.example.com",
      {
        fetch: async (_input, init) => {
          forwardedHeaders = new Headers(init?.headers);
          return new Response("ok", {
            headers: {
              connection: "x-response-hop",
              "x-response-hop": "response-only",
              "x-upstream": "preserved",
            },
          });
        },
      },
    );

    expect(forwardedHeaders?.get("connection")).toBeNull();
    expect(forwardedHeaders?.get("x-request-hop")).toBeNull();
    expect(forwardedHeaders?.get("x-end-to-end")).toBe("preserved");
    expect(response.headers.get("connection")).toBeNull();
    expect(response.headers.get("x-response-hop")).toBeNull();
    expect(response.headers.get("x-upstream")).toBe("preserved");
  });

  it("forwards method, body, query, auth, and streaming responses", async () => {
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      response.writeHead(201, {
        "content-type": "text/plain",
        "x-upstream-query": new URL(request.url || "/", "http://upstream").search,
        "x-upstream-auth": request.headers.authorization || "",
        "x-forwarded-host": request.headers["x-forwarded-host"] || "",
      });
      response.write(`${request.method}:${Buffer.concat(chunks).toString("utf8")}:`);
      setTimeout(() => response.end("done"), 5);
    });
    const origin = await listen(server);
    cleanups.push(() => close(server));

    const response = await proxyAgentRuntimeRequest(
      new Request("http://farm.test/agents/demo?room=one", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          connection: "keep-alive",
        },
        body: "hello",
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      origin,
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-upstream-query")).toBe("?room=one");
    expect(response.headers.get("x-upstream-auth")).toBe("Bearer secret");
    expect(response.headers.get("x-forwarded-host")).toBe("farm.test");
    expect(await response.text()).toBe("POST:hello:done");
  });

  it("rewrites upstream redirects and sanitizes connection failures", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(302, { location: "/agents/next" });
      response.end();
    });
    const origin = await listen(server);
    cleanups.push(() => close(server));

    const redirected = await proxyAgentRuntimeRequest(
      new Request("https://farm.test/agents/start"),
      origin,
    );
    expect(redirected.headers.get("location")).toBe("https://farm.test/agents/next");

    const port = await findAvailableAgentRuntimePort();
    const failed = await proxyAgentRuntimeRequest(
      new Request("https://farm.test/agents/start"),
      `http://127.0.0.1:${port}`,
    );
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "Agent runtime request failed" });
  });
});

describe("managed agent processes", () => {
  it("waits for health and shuts the process down", async () => {
    const port = await findAvailableAgentRuntimePort();
    const runtime = await startManagedAgentRuntime({
      command: process.execPath,
      args: [
        "-e",
        `require('node:http').createServer((_req,res)=>res.end('ok')).listen(${port},'127.0.0.1')`,
      ],
      cwd: process.cwd(),
      label: "test runtime",
      origin: `http://127.0.0.1:${port}`,
    });

    expect(await fetch(`${runtime.origin}/`).then((response) => response.text())).toBe("ok");
    await runtime.stop();
    expect(runtime.process?.signalCode).toBeTruthy();
  });

  it("resolves a project package binary", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-agent-bin-"));
    const packageRoot = join(root, "node_modules", "sample-agent");
    await mkdir(join(packageRoot, "bin"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}\n");
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "sample-agent",
        exports: { "./package.json": "./package.json" },
        bin: { sample: "bin/cli.js" },
      }),
    );
    await writeFile(join(packageRoot, "bin", "cli.js"), "console.log('sample')\n");

    expect(await resolveProjectPackageBin(root, "sample-agent", "sample")).toBe(
      join(await realpath(packageRoot), "bin", "cli.js"),
    );
  });
});

describe("agent runtime normalization", () => {
  it("accepts safe origins and route prefixes", () => {
    expect(normalizeAgentOrigin("https://agent.example.com/")).toBe("https://agent.example.com");
    expect(normalizeAgentRoutePrefix("agents/")).toBe("/agents");
  });

  it("rejects credentials, paths, and application-root ownership", () => {
    expect(() => normalizeAgentOrigin("https://user:pass@agent.example.com")).toThrow(
      "credentials",
    );
    expect(() => normalizeAgentOrigin("https://agent.example.com/private")).toThrow("must not");
    expect(() => normalizeAgentRoutePrefix("/")).toThrow("application root");
  });
});

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  const port = await findAvailableAgentRuntimePort();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  return `http://127.0.0.1:${port}`;
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}
