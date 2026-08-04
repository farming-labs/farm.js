// @vitest-environment node

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { invokeAPIRouteEndpoint } from "../api/runtime";
import {
  bufferFarmRequestBody,
  readNodeRequestBody,
  resolveFarmServerConfig,
} from "../server-http";

describe("Farm server HTTP policy", () => {
  it("resolves safe defaults and size strings", () => {
    expect(resolveFarmServerConfig(undefined)).toEqual({
      bodySizeLimit: 10_000_000,
      trustProxy: false,
      headersTimeout: 60_000,
      requestTimeout: 300_000,
      keepAliveTimeout: 5_000,
      gracefulShutdownTimeout: 30_000,
      health: {
        enabled: true,
        livenessPath: "/_farm/health/live",
        readinessPath: "/_farm/health/ready",
      },
    });
    expect(
      resolveFarmServerConfig({
        bodySizeLimit: "2 MiB",
        trustProxy: true,
        headersTimeout: "15s",
        requestTimeout: "2m",
        keepAliveTimeout: "10s",
        gracefulShutdownTimeout: "45s",
        health: {
          livenessPath: "/health/live/",
          readinessPath: "/health/ready/",
        },
      }),
    ).toEqual({
      bodySizeLimit: 2_097_152,
      trustProxy: true,
      headersTimeout: 15_000,
      requestTimeout: 120_000,
      keepAliveTimeout: 10_000,
      gracefulShutdownTimeout: 45_000,
      health: {
        enabled: true,
        livenessPath: "/health/live",
        readinessPath: "/health/ready",
      },
    });
  });

  it("rejects unsafe timeout and health configurations", () => {
    expect(() => resolveFarmServerConfig({ headersTimeout: "2m", requestTimeout: "30s" })).toThrow(
      "headersTimeout must not exceed",
    );
    expect(() => resolveFarmServerConfig({ requestTimeout: 0 })).toThrow(
      "server.requestTimeout must be a positive safe integer",
    );
    expect(() => resolveFarmServerConfig({ gracefulShutdownTimeout: 2_147_483_648 })).toThrow(
      "server.gracefulShutdownTimeout must not exceed 2147483647 milliseconds",
    );
    expect(() => resolveFarmServerConfig({ gracefulShutdownTimeout: "597h" })).toThrow(
      "server.gracefulShutdownTimeout must not exceed 2147483647 milliseconds",
    );
    expect(() =>
      resolveFarmServerConfig({
        health: { livenessPath: "/health", readinessPath: "/health" },
      }),
    ).toThrow("must be different");
    expect(
      resolveFarmServerConfig({
        health: { livenessPath: "///", readinessPath: "/health/ready" },
      }).health,
    ).toEqual({
      enabled: true,
      livenessPath: "/",
      readinessPath: "/health/ready",
    });
    expect(resolveFarmServerConfig({ health: false }).health.enabled).toBe(false);
  });

  it("rejects streamed Web request bodies above the limit", async () => {
    const request = new Request("https://example.com/upload", {
      method: "POST",
      body: "123456",
    });

    await expect(bufferFarmRequestBody(request, 5)).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
      status: 413,
    });
  });

  it("rejects Node request bodies above the limit", async () => {
    const request = Readable.from([Buffer.from("123"), Buffer.from("456")]) as Readable & {
      headers: Record<string, string>;
    };
    request.headers = {};

    await expect(readNodeRequestBody(request as any, 5)).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
      status: 413,
    });
  });

  it("returns 413 before invoking an API route or upload handler", async () => {
    let invoked = false;
    const response = await invokeAPIRouteEndpoint(
      async () => {
        invoked = true;
        return new Response("ok");
      },
      new Request("https://example.com/api/upload", {
        method: "POST",
        body: "123456",
      }),
      {},
      5,
    );

    expect(response.status).toBe(413);
    expect(invoked).toBe(false);
  });

  it("returns 400 for an invalid Content-Length before invoking the handler", async () => {
    let invoked = false;
    const response = await invokeAPIRouteEndpoint(
      async () => {
        invoked = true;
        return new Response("ok");
      },
      new Request("https://example.com/api/upload", {
        method: "POST",
        headers: { "content-length": "not-a-number" },
        body: "x",
      }),
    );

    expect(response.status).toBe(400);
    expect(invoked).toBe(false);
  });
});
