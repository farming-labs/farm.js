import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginManager } from "../plugin";
import { createLoggerPlugin, type LoggerPluginOptions } from "../plugins/logger";

function createManager(options?: LoggerPluginOptions, isProd = false) {
  const manager = new PluginManager({
    config: {},
    isDev: !isProd,
    isProd,
  });
  manager.addPlugin(createLoggerPlugin(options));
  return manager;
}

function spyOnConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

async function request(
  manager: PluginManager,
  url: string,
  init: RequestInit & { status?: number } = {},
) {
  const { status, ...requestInit } = init;
  return manager.runRuntimeRequest(
    new Request(url, requestInit),
    () => new Response("ok", { status: status ?? 200 }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger plugin", () => {
  it("logs method, path, status, and duration as text in development", async () => {
    const output = spyOnConsole();

    await request(createManager(), "https://farm.test/about?tab=team");

    expect(output.log).toHaveBeenCalledTimes(1);
    expect(output.log.mock.calls[0]?.[0]).toMatch(/^GET \/about\?tab=team 200 \d+ms$/);
    expect(output.error).not.toHaveBeenCalled();
  });

  it("logs one JSON object per request in production", async () => {
    const output = spyOnConsole();

    await request(createManager({}, true), "https://farm.test/api/users?page=2", {
      method: "POST",
      status: 201,
    });

    expect(output.log).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(output.log.mock.calls[0]?.[0] as string);
    expect(entry).toMatchObject({
      level: "info",
      method: "POST",
      path: "/api/users?page=2",
      status: 201,
    });
    expect(typeof entry.durationMs).toBe("number");
    expect(Number.isNaN(Date.parse(entry.time))).toBe(false);
    expect(entry.headers).toBeUndefined();
  });

  it("lets the format option override the environment default", async () => {
    const output = spyOnConsole();

    await request(createManager({ format: "json" }), "https://farm.test/");
    await request(createManager({ format: "text" }, true), "https://farm.test/");

    expect(JSON.parse(output.log.mock.calls[0]?.[0] as string).path).toBe("/");
    expect(output.log.mock.calls[1]?.[0]).toMatch(/^GET \/ 200 \d+ms$/);
  });

  it("writes failing responses to stderr with a matching level", async () => {
    const output = spyOnConsole();
    const manager = createManager({ format: "json" });

    await request(manager, "https://farm.test/missing", { status: 404 });
    await request(manager, "https://farm.test/boom", { status: 500 });

    expect(JSON.parse(output.log.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "warn",
      status: 404,
    });
    expect(output.error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output.error.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "error",
      path: "/boom",
      status: 500,
    });
  });

  it("masks credential query values by default and keeps the rest of the query intact", async () => {
    const output = spyOnConsole();

    await request(
      createManager({ format: "json" }),
      "https://farm.test/cb?code=1&token=abc&tag=a&tag=b&API_KEY=k&pass%77ord=p",
    );

    const entry = JSON.parse(output.log.mock.calls[0]?.[0] as string);
    expect(entry.path).toBe(
      "/cb?code=1&token=[redacted]&tag=a&tag=b&API_KEY=[redacted]&pass%77ord=[redacted]",
    );
  });

  it("masks the names listed in the redact option in addition to the defaults", async () => {
    const output = spyOnConsole();

    await request(
      createManager({ format: "json", redact: ["Session"] }),
      "https://farm.test/?session=s1&token=t1&page=3",
    );

    expect(JSON.parse(output.log.mock.calls[0]?.[0] as string).path).toBe(
      "/?session=[redacted]&token=[redacted]&page=3",
    );
  });

  it("logs only the listed headers and masks redacted ones", async () => {
    const output = spyOnConsole();

    await request(
      createManager({
        format: "json",
        headers: ["User-Agent", "Authorization", "x-missing"],
      }),
      "https://farm.test/",
      { headers: { "user-agent": "vitest", authorization: "Bearer secret", cookie: "sid=1" } },
    );

    const entry = JSON.parse(output.log.mock.calls[0]?.[0] as string);
    expect(entry.headers).toEqual({ "user-agent": "vitest", authorization: "[redacted]" });
    expect(JSON.stringify(entry)).not.toContain("Bearer secret");
    expect(JSON.stringify(entry)).not.toContain("sid=1");
  });

  it("appends selected headers to the text format", async () => {
    const output = spyOnConsole();

    await request(createManager({ headers: ["x-request-id"] }), "https://farm.test/", {
      headers: { "x-request-id": "req-1" },
    });

    expect(output.log.mock.calls[0]?.[0]).toMatch(/^GET \/ 200 \d+ms x-request-id="req-1"$/);
  });

  it("samples routine requests but always logs server errors", async () => {
    const output = spyOnConsole();
    const random = vi.spyOn(Math, "random");
    const manager = createManager({ format: "json", sample: 0.5 });

    random.mockReturnValue(0.75);
    await request(manager, "https://farm.test/skipped");
    await request(manager, "https://farm.test/failed", { status: 503 });
    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledTimes(1);

    random.mockReturnValue(0.25);
    await request(manager, "https://farm.test/kept");
    expect(output.log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output.log.mock.calls[0]?.[0] as string).path).toBe("/kept");
  });

  it("logs nothing when the sample rate is zero except server errors", async () => {
    const output = spyOnConsole();
    const manager = createManager({ sample: 0 });

    await request(manager, "https://farm.test/");
    await request(manager, "https://farm.test/", { status: 500 });

    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledTimes(1);
  });

  it("rejects a sample rate outside 0 to 1", () => {
    for (const sample of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createLoggerPlugin({ sample })).toThrow(/"sample" must be a number from 0 to 1/);
    }
  });

  it("does not change the response", async () => {
    spyOnConsole();

    const response = await request(createManager(), "https://farm.test/", { status: 202 });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("ok");
  });

  it("keeps the deprecated callbacks working next to the request log", async () => {
    const output = spyOnConsole();
    const plugin = createLoggerPlugin({
      beforeRequest: vi.fn(),
      afterResponse: vi.fn(),
    });

    expect(typeof plugin.beforeRequest).toBe("function");
    expect(typeof plugin.afterResponse).toBe("function");
    expect(plugin.runtime?.after).toBeTypeOf("function");
    expect(createLoggerPlugin().beforeRequest).toBeUndefined();
    expect(createLoggerPlugin().afterResponse).toBeUndefined();
    expect(output.log).not.toHaveBeenCalled();
  });
});
