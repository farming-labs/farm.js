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
});
