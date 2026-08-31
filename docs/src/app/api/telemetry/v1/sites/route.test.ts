// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

function sitePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    eventType: "production_site_active",
    siteUrl: "https://example.com",
    packageName: "@farm.js/core",
    packageVersion: "1.0.0",
    renderer: "react",
    deployTarget: "vercel",
    ...overrides,
  };
}

function request(body: Record<string, unknown>): Request {
  return new Request("https://farmjs.dev/api/telemetry/v1/sites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("production-site telemetry ingestion", () => {
  it("accepts a normalized detected origin without blocking on an unavailable database", async () => {
    delete process.env.DATABASE_URL;

    const response = await POST(request(sitePayload()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stored: false,
      warning: "database_not_configured",
    });
  });

  it("rejects request-level URL data", async () => {
    const response = await POST(
      request(sitePayload({ siteUrl: "https://example.com/private?token=secret" })),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_site" });
  });

  it("rejects fields outside the versioned schema", async () => {
    const response = await POST(request(sitePayload({ requestPath: "/private" })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_site" });
  });
});
