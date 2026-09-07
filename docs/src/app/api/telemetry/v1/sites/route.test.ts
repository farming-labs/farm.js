// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { farmLegacyVercelPreviewSiteWhere } from "../../../../../lib/telemetry-sites";
import { POST } from "./route";

const prismaMocks = vi.hoisted(() => ({
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  upsert: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../../../lib/prisma", () => ({
  getPrisma: async () => ({
    farmProductionSite: prismaMocks,
  }),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  prismaMocks.deleteMany.mockClear();
  prismaMocks.upsert.mockClear();
});

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

  it("accepts but does not store a known Vercel branch-preview alias", async () => {
    delete process.env.DATABASE_URL;

    const response = await POST(
      request(
        sitePayload({
          siteUrl: "https://docs-git-fix-query-array-round-trip-kinfe123s-projects.vercel.app",
        }),
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stored: false,
      warning: "preview_deployment",
    });
  });

  it("keeps a production vercel.app origin eligible", async () => {
    delete process.env.DATABASE_URL;

    const response = await POST(
      request(sitePayload({ siteUrl: "https://farm-git-tools.vercel.app" })),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stored: false,
      warning: "database_not_configured",
    });
  });

  it("removes a previously stored Vercel branch-preview alias", async () => {
    process.env.DATABASE_URL = "postgresql://telemetry.invalid/farmjs";
    const siteUrl = "https://docs-git-fix-query-array-round-trip-kinfe123s-projects.vercel.app";

    const response = await POST(request(sitePayload({ siteUrl })));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stored: false,
      warning: "preview_deployment",
    });
    expect(prismaMocks.upsert).not.toHaveBeenCalled();
    expect(prismaMocks.deleteMany).toHaveBeenCalledWith({ where: { url: siteUrl } });
    expect(prismaMocks.deleteMany).toHaveBeenCalledWith({
      where: farmLegacyVercelPreviewSiteWhere,
    });
  });
});
