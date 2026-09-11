import { describe, expect, it, vi } from "vitest";
import { health } from "./index";

describe("health plugin", () => {
  it("registers exact endpoints with HTTP probe semantics", async () => {
    const runtime = await setup(health(), { basePath: "/store" });
    expect(runtime.paths).toEqual(["/health/live", "/health/ready", "/health/startup"]);

    const live = await runtime.request("/health/live");
    expect(live.status).toBe(200);
    await expect(live.json()).resolves.toEqual({ status: "ok" });
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(live.headers.get("x-content-type-options")).toBe("nosniff");

    const head = await runtime.request("/health/live", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const method = await runtime.request("/health/live", { method: "POST" });
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET, HEAD");
  });

  it("gates readiness on required checks without exposing failures by default", async () => {
    const runtime = await setup(
      health({
        checks: {
          database: () => false,
          cache: {
            check: () => Promise.reject(new Error("redis://user:secret@cache")),
            required: false,
          },
        },
      }),
    );

    const response = await runtime.request("/health/ready");
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });

  it("reports optional failures as degraded and exposes only safe details", async () => {
    const runtime = await setup(
      health({
        details: true,
        checks: {
          database: () => true,
          cache: { check: () => false, required: false },
        },
      }),
    );

    const response = await runtime.request("/health/ready");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toMatchObject({
      status: "ok",
      required: true,
      probe: "readiness",
    });
    expect(body.checks.cache).toMatchObject({
      status: "unavailable",
      required: false,
      probe: "readiness",
    });
    expect(JSON.stringify(body)).not.toContain("error");
  });

  it("allows request-aware detail disclosure and fails closed", async () => {
    const runtime = await setup(
      health({
        details: (request) => {
          if (request.headers.get("x-break") === "1") throw new Error("predicate failed");
          return request.headers.get("authorization") === "Bearer test-token";
        },
        checks: { database: () => false },
      }),
    );

    const hidden = await runtime.request("/health/ready", {
      headers: { "x-break": "1" },
    });
    expect(await hidden.json()).toEqual({ status: "unavailable" });

    const visible = await runtime.request("/health/ready", {
      headers: { authorization: "Bearer test-token" },
    });
    expect((await visible.json()).checks.database.status).toBe("unavailable");
  });

  it("retries startup checks until they pass and then latches success", async () => {
    const migrations = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const database = vi.fn().mockReturnValue(true);
    const runtime = await setup(
      health({
        details: true,
        startupChecks: { migrations },
        checks: { database },
      }),
    );

    expect((await runtime.request("/health/startup")).status).toBe(503);
    expect((await runtime.request("/health/startup")).status).toBe(200);
    const ready = await runtime.request("/health/ready");

    expect(ready.status).toBe(200);
    expect(migrations).toHaveBeenCalledTimes(2);
    expect(database).toHaveBeenCalledOnce();
    const body = await ready.json();
    expect(Object.keys(body.checks)).toEqual(["migrations", "database"]);
  });

  it("times out checks and passes an abort signal", async () => {
    let timeoutAborted = false;
    const runtime = await setup(
      health({
        timeout: 20,
        checks: {
          slow: ({ signal }) =>
            new Promise((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  timeoutAborted = true;
                  resolve(true);
                },
                { once: true },
              );
            }),
        },
      }),
    );

    const response = await runtime.request("/health/ready");
    expect(response.status).toBe(503);
    expect(timeoutAborted).toBe(true);
  });

  it("turns every probe unavailable when the runtime closes", async () => {
    const runtime = await setup(health({ checks: { database: () => true } }));

    await runtime.close();

    expect((await runtime.request("/health/live")).status).toBe(503);
    expect((await runtime.request("/health/ready")).status).toBe(503);
    expect((await runtime.request("/health/startup")).status).toBe(503);
  });

  it("rejects duplicate plugin instances and core endpoint conflicts", () => {
    const first = health();
    const second = health();
    expect(() =>
      first.configure?.({ root: "/app", plugins: [first, second] }, {} as never),
    ).toThrow("one health() plugin instance");

    const coreCollision = health({ paths: { liveness: "/_farm/health/live" } });
    expect(() =>
      coreCollision.configure?.({ root: "/app", plugins: [coreCollision] }, {} as never),
    ).toThrow("conflicts with server.health");
  });

  it("does not mutate configured application middleware", async () => {
    const existing = { matcher: "/dashboard/**", handler: vi.fn() };
    const plugin = health();
    const config = { root: "/app", plugins: [plugin], middleware: existing };

    await plugin.configure?.(config, {} as never);

    expect(config.middleware).toBe(existing);
  });
});

async function setup(plugin: ReturnType<typeof health>, config: Record<string, unknown> = {}) {
  const appConfig = { root: "/app", plugins: [plugin], ...config };
  await plugin.configure?.(appConfig, {} as never);
  const state = await plugin.setup?.({} as never);
  if (!state) throw new Error("Health setup did not return state");
  const endpoints = plugin.runtime?.endpoints ?? [];

  return {
    paths: endpoints.map((endpoint) => endpoint.path),
    async request(path: string, init?: RequestInit) {
      const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
      const endpoint = endpoints.find((candidate) => {
        const candidatePath =
          candidate.path.length > 1 ? candidate.path.replace(/\/+$/, "") : candidate.path;
        return candidatePath === normalized;
      });
      if (!endpoint) throw new Error(`No health endpoint registered for ${path}`);
      const request = new Request(`https://example.com${path}`, init);
      return endpoint.handler({ request, state } as never);
    },
    async close() {
      await plugin.runtime?.close?.({ state, reason: "test" } as never);
    },
  };
}
