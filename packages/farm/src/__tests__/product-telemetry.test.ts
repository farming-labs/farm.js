// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFarmProductionSiteReporter,
  detectFarmProductionSiteOrigin,
  normalizeFarmProductionSiteOrigin,
} from "../product-telemetry";
import { FARM_VERSION } from "../version";

const originalEnvironment = {
  DO_NOT_TRACK: process.env.DO_NOT_TRACK,
  FARM_TELEMETRY: process.env.FARM_TELEMETRY,
  FARM_TELEMETRY_DISABLED: process.env.FARM_TELEMETRY_DISABLED,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("production-site origin detection", () => {
  it("automatically reduces a production request URL to its HTTPS origin", () => {
    expect(detectFarmProductionSiteOrigin("https://Example.com/private?token=secret#section")).toBe(
      "https://example.com",
    );
    expect(detectFarmProductionSiteOrigin(new URL("https://www.example.com:8443/products"))).toBe(
      "https://www.example.com:8443",
    );
    expect(normalizeFarmProductionSiteOrigin("https://Example.com/")).toBe("https://example.com");
  });

  it.each([
    "http://example.com/products",
    "https://intranet/products",
    "https://localhost/products",
    "https://preview.localhost/products",
    "https://service.local/products",
    "https://127.0.0.1/products",
    "https://[::1]/products",
  ])("ignores a non-public production request URL: %s", (requestUrl) => {
    expect(detectFarmProductionSiteOrigin(requestUrl)).toBeUndefined();
  });

  it.each([
    "https://user:secret@example.com",
    "https://example.com/products",
    "https://example.com/?campaign=private",
    "https://example.com/#private",
  ])("rejects a non-origin ingestion value: %s", (siteUrl) => {
    expect(normalizeFarmProductionSiteOrigin(siteUrl)).toBeUndefined();
  });
});

describe("production-site telemetry reporting", () => {
  it("hands delivery to waitUntil without waiting for the network", async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
    const send = vi.fn(() => response) as unknown as typeof fetch;
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    const reporter = createFarmProductionSiteReporter({
      renderer: "react",
      deployTarget: "vercel",
      endpoint: "http://127.0.0.1:43199/sites",
      fetch: send,
      now: () => 1_000,
    });

    reporter.report("https://example.com/customers/acme?token=secret", waitUntil);

    expect(send).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      "http://127.0.0.1:43199/sites",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          eventType: "production_site_active",
          siteUrl: "https://example.com",
          packageName: "@farm.js/core",
          packageVersion: FARM_VERSION,
          renderer: "react",
          deployTarget: "vercel",
        }),
        signal: expect.any(AbortSignal),
      }),
    );

    finishRequest?.(new Response(null, { status: 202 }));
    await waitUntil.mock.calls[0]![0];
  });

  it("tracks the report interval independently for each detected origin", async () => {
    let now = 10_000;
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const deliveries: Promise<unknown>[] = [];
    const reporter = createFarmProductionSiteReporter({
      renderer: "react",
      endpoint: "http://localhost:43199/sites",
      fetch: send,
      now: () => now,
      reportIntervalMs: 60_000,
      retryIntervalMs: 5_000,
    });

    reporter.report("https://one.example.com/a", (promise) => deliveries.push(promise));
    reporter.report("https://two.example.com/b", (promise) => deliveries.push(promise));
    await Promise.all(deliveries);
    expect(send).toHaveBeenCalledTimes(2);

    reporter.report("https://one.example.com/c", (promise) => deliveries.push(promise));
    expect(send).toHaveBeenCalledTimes(2);

    now += 60_000;
    reporter.report("https://one.example.com/d", (promise) => deliveries.push(promise));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("retries a check-in that was accepted without being stored", async () => {
    let now = 10_000;
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, stored: false }, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const deliveries: Promise<unknown>[] = [];
    const reporter = createFarmProductionSiteReporter({
      renderer: "react",
      endpoint: "http://localhost:43199/sites",
      fetch: send,
      now: () => now,
      reportIntervalMs: 60_000,
      retryIntervalMs: 5_000,
    });

    reporter.report("https://example.com", (promise) => deliveries.push(promise));
    await deliveries.at(-1);

    now += 4_999;
    reporter.report("https://example.com", (promise) => deliveries.push(promise));
    expect(send).toHaveBeenCalledTimes(1);

    now += 1;
    reporter.report("https://example.com", (promise) => deliveries.push(promise));
    await deliveries.at(-1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not report local requests", () => {
    const send = vi.fn<typeof fetch>();
    const reporter = createFarmProductionSiteReporter({ renderer: "react", fetch: send });

    reporter.report("http://localhost:3000/products");
    reporter.report("https://preview.localhost/products");

    expect(send).not.toHaveBeenCalled();
  });

  it("bounds automatically detected origins per running instance", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const deliveries: Promise<unknown>[] = [];
    const reporter = createFarmProductionSiteReporter({ renderer: "react", fetch: send });

    for (let index = 0; index < 33; index += 1) {
      reporter.report(`https://site-${index}.example.com/path`, (promise) =>
        deliveries.push(promise),
      );
    }
    await Promise.all(deliveries);

    expect(send).toHaveBeenCalledTimes(32);
  });

  it.each([
    ["DO_NOT_TRACK", "1"],
    ["FARM_TELEMETRY_DISABLED", "true"],
    ["FARM_TELEMETRY", "0"],
  ])("honors the %s environment opt-out", (key, value) => {
    delete process.env.DO_NOT_TRACK;
    delete process.env.FARM_TELEMETRY_DISABLED;
    delete process.env.FARM_TELEMETRY;
    process.env[key] = value;
    const send = vi.fn<typeof fetch>();
    const reporter = createFarmProductionSiteReporter({ renderer: "react", fetch: send });

    reporter.report("https://example.com");

    expect(send).not.toHaveBeenCalled();
  });
});
