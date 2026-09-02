// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createFarmProductionLifecycle } from "../production-lifecycle";
import { resolveFarmServerConfig } from "../server-http";

describe("Farm production lifecycle", () => {
  it("starts once and exposes separate liveness and readiness responses", async () => {
    const start = vi.fn(async () => {});
    const lifecycle = createFarmProductionLifecycle({
      server: resolveFarmServerConfig(undefined),
      start,
    });

    const liveness = await lifecycle.handleHealthRequest(
      new Request("https://example.com/_farm/health/live"),
    );
    expect(liveness?.status).toBe(200);
    expect(start).not.toHaveBeenCalled();

    const readiness = await lifecycle.handleHealthRequest(
      new Request("https://example.com/_farm/health/ready"),
    );
    expect(readiness?.status).toBe(200);
    expect(start).toHaveBeenCalledTimes(1);
    expect(lifecycle.state).toBe("ready");

    await lifecycle.start();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("records synchronous startup failures and does not retry them", async () => {
    const startError = new Error("synchronous startup failed");
    const start = vi.fn(() => {
      throw startError;
    });
    const lifecycle = createFarmProductionLifecycle({
      server: resolveFarmServerConfig(undefined),
      start,
    });

    await expect(lifecycle.start()).rejects.toBe(startError);
    await expect(lifecycle.start()).rejects.toBe(startError);
    expect(start).toHaveBeenCalledTimes(1);
    expect(lifecycle.state).toBe("failed");

    const liveness = await lifecycle.handleHealthRequest(
      new Request("https://example.com/_farm/health/live"),
    );
    expect(liveness?.status).toBe(503);
  });

  it("fails readiness and rejects new work while draining", async () => {
    const handler = vi.fn(async () => new Response("should not run"));
    const lifecycle = createFarmProductionLifecycle({
      server: resolveFarmServerConfig(undefined),
    });
    lifecycle.beginDrain("SIGTERM");

    const readiness = await lifecycle.handleHealthRequest(
      new Request("https://example.com/_farm/health/ready"),
    );
    const liveness = await lifecycle.handleHealthRequest(
      new Request("https://example.com/_farm/health/live"),
    );
    const response = await lifecycle.runRequest(handler);

    expect(readiness?.status).toBe(503);
    expect(readiness?.headers.get("retry-after")).toBe("1");
    expect(liveness?.status).toBe(200);
    expect(response.status).toBe(503);
    expect(response.headers.get("connection")).toBe("close");
    expect(handler).not.toHaveBeenCalled();
  });

  it("tracks a streaming response until it closes", async () => {
    const lifecycle = createFarmProductionLifecycle({
      server: resolveFarmServerConfig(undefined),
    });
    const response = await lifecycle.runRequest(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("hello"));
              controller.close();
            },
          }),
        ),
    );

    expect(lifecycle.activeRequests).toBe(1);
    await expect(response.text()).resolves.toBe("hello");
    expect(lifecycle.activeRequests).toBe(0);
    await expect(lifecycle.waitForIdle(10)).resolves.toBe(true);
  });

  it("uses adapter completion notifications without consuming the response body", async () => {
    const lifecycle = createFarmProductionLifecycle({
      server: resolveFarmServerConfig(undefined),
    });
    let finishResponse: (() => void) | undefined;
    const response = await lifecycle.runRequest(() => new Response("hello"), {
      onResponseFinished(callback) {
        finishResponse = callback;
      },
    });

    expect(lifecycle.activeRequests).toBe(1);
    await expect(response.text()).resolves.toBe("hello");
    expect(lifecycle.activeRequests).toBe(1);
    finishResponse?.();
    expect(lifecycle.activeRequests).toBe(0);
  });

  it("finishes tracking when a returned response body is already consumed or locked", async () => {
    const lifecycle = createFarmProductionLifecycle({
      server: resolveFarmServerConfig(undefined),
    });
    const consumedResponse = new Response("consumed");
    await consumedResponse.text();

    await expect(lifecycle.runRequest(() => consumedResponse)).resolves.toBe(consumedResponse);
    expect(lifecycle.activeRequests).toBe(0);

    const lockedResponse = new Response("locked");
    const reader = lockedResponse.body!.getReader();
    await expect(lifecycle.runRequest(() => lockedResponse)).resolves.toBe(lockedResponse);
    expect(lifecycle.activeRequests).toBe(0);
    reader.releaseLock();
  });

  it("closes the underlying runtime exactly once", async () => {
    const close = vi.fn(async () => {});
    const lifecycle = createFarmProductionLifecycle({
      server: resolveFarmServerConfig(undefined),
      close,
    });
    await lifecycle.start();

    await Promise.all([lifecycle.close("SIGTERM"), lifecycle.close("SIGINT")]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith("SIGTERM");
    expect(lifecycle.state).toBe("closed");
  });

  it("waits for an in-progress startup before closing its resources", async () => {
    let finishStartup!: () => void;
    const startup = new Promise<void>((resolve) => {
      finishStartup = resolve;
    });
    const calls: string[] = [];
    const lifecycle = createFarmProductionLifecycle({
      server: resolveFarmServerConfig(undefined),
      async start() {
        calls.push("start:begin");
        await startup;
        calls.push("start:end");
      },
      async close() {
        calls.push("close");
      },
    });

    const starting = lifecycle.start();
    const closing = lifecycle.close("SIGTERM");
    await Promise.resolve();
    expect(calls).toEqual(["start:begin"]);

    finishStartup();
    await Promise.all([starting, closing]);

    expect(calls).toEqual(["start:begin", "start:end", "close"]);
    expect(lifecycle.state).toBe("closed");
  });

  it("deduplicates forced cleanup when startup does not settle", async () => {
    let finishStartup!: () => void;
    const startup = new Promise<void>((resolve) => {
      finishStartup = resolve;
    });
    const close = vi.fn(async () => {});
    const lifecycle = createFarmProductionLifecycle({
      server: resolveFarmServerConfig(undefined),
      start: () => startup,
      close,
    });

    const starting = lifecycle.start();
    const closing = lifecycle.close("SIGTERM");
    await lifecycle.forceClose("SIGTERM");
    await expect(closing).resolves.toBeUndefined();

    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith("SIGTERM");
    expect(lifecycle.state).toBe("closed");

    finishStartup();
    await Promise.all([starting, closing]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("stays closed when startup rejects after forced cleanup", async () => {
    let failStartup!: (error: Error) => void;
    const startup = new Promise<void>((_resolve, reject) => {
      failStartup = reject;
    });
    const lifecycle = createFarmProductionLifecycle({
      server: resolveFarmServerConfig(undefined),
      start: () => startup,
      close: async () => {},
    });

    const starting = lifecycle.start();
    await lifecycle.forceClose("SIGTERM");
    const startupError = new Error("late startup failure");
    failStartup(startupError);

    await expect(starting).rejects.toBe(startupError);
    expect(lifecycle.state).toBe("closed");
    await expect(lifecycle.runRequest(() => new Response("unexpected"))).resolves.toMatchObject({
      status: 503,
    });
  });

  it("memoizes synchronous close failures and still reaches closed", async () => {
    const closeError = new Error("synchronous close failed");
    const close = vi.fn(() => {
      throw closeError;
    });
    const lifecycle = createFarmProductionLifecycle({
      server: resolveFarmServerConfig(undefined),
      close,
    });
    await lifecycle.start();

    await expect(lifecycle.close("SIGTERM")).rejects.toBe(closeError);
    await expect(lifecycle.close("SIGINT")).rejects.toBe(closeError);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith("SIGTERM");
    expect(lifecycle.state).toBe("closed");
  });
});
