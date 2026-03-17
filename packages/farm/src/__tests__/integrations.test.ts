import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import { PluginManager } from "../plugin";
import {
  defineIntegration,
  getIntegrationDocumentNavigationMatchers,
  resolveIntegrationPlugins,
} from "../integrations";

function createManager() {
  return new PluginManager({
    config: {},
    isDev: true,
    isProd: false,
  });
}

function createRequest(url: string, method = "GET") {
  const req = new EventEmitter() as EventEmitter & {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  req.url = url;
  req.method = method;
  req.headers = {
    host: "localhost:3000",
    "x-request-id": "req-1",
  };
  return req;
}

function createResponse() {
  const headers = new Map<string, string | string[]>();
  return {
    statusCode: 200,
    writableEnded: false,
    body: Buffer.alloc(0),
    setHeader(key: string, value: string | string[]) {
      headers.set(key, value);
    },
    getHeader(key: string) {
      return headers.get(key);
    },
    end(value?: Buffer | string) {
      this.writableEnded = true;
      if (typeof value === "string") {
        this.body = Buffer.from(value);
        return;
      }
      this.body = value || Buffer.alloc(0);
    },
  };
}

describe("integrations runtime", () => {
  it("registers route integrations as pre-plugins and handles matching requests", async () => {
    const log = vi.fn();
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        auth: defineIntegration({
          slot: "auth",
          type: "better-auth",
          instance: {
            handler: vi.fn(),
          },
          log,
          routes: [
            {
              path: "/api/auth/[...auth]",
              methods: ["GET", "POST"],
              handler: () => new Response("ok", { status: 201 }),
            },
          ],
        }),
      }),
    );

    await manager.runHookParallel("init");

    const req = createRequest("/api/auth/session");
    const res = createResponse();
    const ended = await manager.runHookParallel("beforeRequest", req as any, res as any);

    expect(ended).toBe(true);
    expect(res.writableEnded).toBe(true);
    expect(res.statusCode).toBe(201);
    expect(res.body.toString()).toBe("ok");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "registered",
        route: expect.objectContaining({
          path: "/api/auth/[...auth]",
        }),
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "request:start",
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "request:end",
        durationMs: expect.any(Number),
      }),
    );
  });

  it("runs integration middleware before routes and can short-circuit the request", async () => {
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        auth: defineIntegration({
          slot: "auth",
          type: "clerk",
          instance: {},
          middleware: [
            {
              matcher: "/dashboard(.*)",
              handler: () => new Response("blocked", { status: 401 }),
            },
          ],
        }),
      }),
    );

    const req = createRequest("/dashboard/settings");
    const res = createResponse();
    const ended = await manager.runHookParallel("beforeRequest", req as any, res as any);

    expect(ended).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(res.body.toString()).toBe("blocked");
  });

  it("collects document navigation matchers from integrations", () => {
    const matchers = getIntegrationDocumentNavigationMatchers({
      auth: defineIntegration({
        slot: "auth",
        type: "clerk",
        instance: {},
        documentNavigations: [
          {
            matcher: ["/sign-in(.*)", "/sign-up(.*)"],
          },
        ],
      }),
    });

    expect(matchers).toEqual(["/sign-in(.*)", "/sign-up(.*)"]);
  });
});
