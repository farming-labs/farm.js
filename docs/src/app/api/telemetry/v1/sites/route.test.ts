// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { farmLegacyVercelPreviewSiteWhere } from "../../../../../lib/telemetry-sites";
import { POST } from "./route";

// Like Prisma, the upsert returns the stored row: here, always the one `create` would write.
const prismaMocks = vi.hoisted(() => ({
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({ ...create })),
}));
const attestationMocks = vi.hoisted(() => ({
  verify: vi.fn(),
}));
const afterMocks = vi.hoisted(() => ({ callbacks: [] as Array<() => unknown> }));
const webhookMocks = vi.hoisted(() => ({ notify: vi.fn(async () => true) }));

vi.mock("@farm.js/core/after", () => ({
  after: (callback: () => unknown) => {
    afterMocks.callbacks.push(callback);
  },
}));
vi.mock("../../../../../lib/new-site-webhook", () => ({
  notifyNewFarmSite: webhookMocks.notify,
}));

vi.mock("../../../../../lib/prisma", () => ({
  getPrisma: async () => ({
    farmProductionSite: prismaMocks,
  }),
}));
vi.mock("../../../../../lib/telemetry-site-attestation", () => ({
  verifyFarmProductionSiteAttestation: attestationMocks.verify,
}));

const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  prismaMocks.deleteMany.mockClear();
  prismaMocks.upsert.mockClear();
  afterMocks.callbacks.length = 0;
  webhookMocks.notify.mockClear();
  attestationMocks.verify.mockReset().mockResolvedValue({
    schemaVersion: 1,
    eventType: "production_site_attestation",
    packageName: "@farm.js/core",
    packageVersion: "1.0.0",
    renderer: "react",
    deployTarget: "vercel",
  });
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

  it("rejects an oversized chunked body without draining it", async () => {
    delete process.env.DATABASE_URL;
    let pushed = 0;
    const chunk = new Uint8Array(1024).fill(0x61);
    // No content-length: a chunked upload, so the header pre-check cannot help.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pushed += 1;
        if (pushed > 4096) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });

    const response = await POST(
      new Request("https://farmjs.dev/api/telemetry/v1/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
    );

    expect(response.status).toBe(413);
    // The read must stop shortly past the 8 KB ceiling rather than buffering
    // the whole 4 MB an unauthenticated caller offered.
    expect(pushed).toBeLessThan(64);
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

  it("does not store a site whose origin does not attest Farm", async () => {
    process.env.DATABASE_URL = "postgresql://telemetry.invalid/farmjs";
    attestationMocks.verify.mockResolvedValueOnce(undefined);

    const response = await POST(request(sitePayload()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stored: false,
      warning: "site_unverified",
    });
    expect(prismaMocks.upsert).not.toHaveBeenCalled();
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

  it("stores metadata returned by the attested origin instead of claimed metadata", async () => {
    process.env.DATABASE_URL = "postgresql://telemetry.invalid/farmjs";
    attestationMocks.verify.mockResolvedValueOnce({
      schemaVersion: 1,
      eventType: "production_site_attestation",
      packageName: "@farm.js/core",
      packageVersion: "2.0.0",
      renderer: "solid",
      deployTarget: "cloudflare",
    });

    const response = await POST(
      request(
        sitePayload({
          packageVersion: "999.0.0",
          renderer: "fake",
          deployTarget: "fake",
        }),
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true, stored: true });
    expect(attestationMocks.verify).toHaveBeenCalledWith("https://example.com");
    expect(prismaMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          packageName: "@farm.js/core",
          packageVersion: "2.0.0",
          renderer: "solid",
          deployTarget: "cloudflare",
        }),
        create: expect.objectContaining({
          packageName: "@farm.js/core",
          packageVersion: "2.0.0",
          renderer: "solid",
          deployTarget: "cloudflare",
        }),
      }),
    );
  });
  it("announces a site to the webhook after the response the first time it is stored", async () => {
    process.env.DATABASE_URL = "postgresql://telemetry.invalid/farmjs";

    const response = await POST(request(sitePayload()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true, stored: true });
    // Scheduled with after(), not awaited by the request.
    expect(webhookMocks.notify).not.toHaveBeenCalled();
    expect(afterMocks.callbacks).toHaveLength(1);
    await afterMocks.callbacks[0]!();
    expect(webhookMocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
        packageVersion: "1.0.0",
        renderer: "react",
        deployTarget: "vercel",
      }),
    );
  });

  it("does not announce a site it has already stored", async () => {
    process.env.DATABASE_URL = "postgresql://telemetry.invalid/farmjs";
    prismaMocks.upsert.mockImplementationOnce(async ({ create }) => ({
      ...create,
      firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
    }));

    const response = await POST(request(sitePayload()));

    await expect(response.json()).resolves.toEqual({ ok: true, stored: true });
    expect(afterMocks.callbacks).toHaveLength(0);
  });
});
