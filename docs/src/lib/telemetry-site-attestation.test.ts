// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { verifyFarmProductionSiteAttestation } from "./telemetry-site-attestation";

function attestation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    eventType: "production_site_attestation",
    packageName: "@farm.js/core",
    packageVersion: "1.0.0",
    renderer: "react",
    deployTarget: "vercel",
    ...overrides,
  };
}

describe("production-site origin attestation", () => {
  it("reads strict framework metadata from the claimed origin", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(attestation()));

    await expect(
      verifyFarmProductionSiteAttestation("https://example.com", { fetch: send }),
    ).resolves.toEqual(attestation());
    expect(send).toHaveBeenCalledWith(
      new URL("https://example.com/.well-known/farm-telemetry"),
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
  });

  it.each([
    ["redirect", new Response(null, { status: 302, headers: { location: "https://other.test" } })],
    ["wrong content type", new Response(JSON.stringify(attestation()), { status: 200 })],
    ["unknown field", Response.json(attestation({ extra: "value" }))],
    ["wrong event", Response.json(attestation({ eventType: "production_site_active" }))],
    [
      "oversized body",
      new Response("a".repeat(4 * 1024 + 1), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ],
  ])("rejects a %s response", async (_label, response) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      verifyFarmProductionSiteAttestation("https://example.com", { fetch: send }),
    ).resolves.toBeUndefined();
  });

  it("rejects a private origin before making a request", async () => {
    const send = vi.fn<typeof fetch>();

    await expect(
      verifyFarmProductionSiteAttestation("https://127.0.0.1", { fetch: send }),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
