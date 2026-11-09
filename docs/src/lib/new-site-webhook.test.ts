// @vitest-environment node

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FARM_NEW_SITE_WEBHOOK_EVENT, notifyNewFarmSite } from "./new-site-webhook";

const WEBHOOK = "https://hooks.example.com/services/T000/B000/secret-token";
const site = {
  url: "https://shop.example.com",
  packageVersion: "0.1.62",
  renderer: "react",
  deployTarget: "vercel",
  firstSeenAt: new Date("2026-11-09T12:00:00.000Z"),
};
const noSleep = async () => {};

afterEach(() => {
  vi.restoreAllMocks();
});

function recordingFetch(...statuses: Array<number | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const next = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
    if (next instanceof Error) throw next;
    return new Response(null, { status: next });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe("new Farm.js site webhook", () => {
  it("sends nothing without a configured https webhook", async () => {
    const { fetch, calls } = recordingFetch(200);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(notifyNewFarmSite(site, { url: "", fetch })).resolves.toBe(false);
    await expect(
      notifyNewFarmSite(site, { url: "http://hooks.example.com/x", fetch }),
    ).resolves.toBe(false);

    expect(calls).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith(
      "[farmjs.telemetry.new-site-webhook]",
      "FARM_NEW_SITE_WEBHOOK_URL must use https",
    );
  });

  it("posts the site as JSON with a one-line text and a verifiable signature", async () => {
    const { fetch, calls } = recordingFetch(200);

    await expect(
      notifyNewFarmSite(site, {
        url: WEBHOOK,
        secret: "s3cret",
        fetch,
        now: () => 1_794_000_000_000,
      }),
    ).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    const body = String(init.body);
    expect(JSON.parse(body)).toEqual({
      event: FARM_NEW_SITE_WEBHOOK_EVENT,
      site: { ...site, firstSeenAt: "2026-11-09T12:00:00.000Z" },
      text: "New Farm.js site: https://shop.example.com (v0.1.62, react, vercel)",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["x-farm-event"]).toBe("farm.site.created");
    expect(headers["x-farm-timestamp"]).toBe("1794000000");
    const expected = createHmac("sha256", "s3cret").update(`1794000000.${body}`).digest("hex");
    expect(headers["x-farm-signature"]).toBe(`sha256=${expected}`);
  });

  it("omits signature headers without a secret", async () => {
    const { fetch, calls } = recordingFetch(204);

    await expect(notifyNewFarmSite(site, { url: WEBHOOK, secret: "", fetch })).resolves.toBe(true);

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("x-farm-signature");
    expect(headers).not.toHaveProperty("x-farm-timestamp");
  });

  it("retries a rate limit or server error, then succeeds", async () => {
    const { fetch, calls } = recordingFetch(503, 429, 200);
    const sleeps: number[] = [];

    await expect(
      notifyNewFarmSite(site, {
        url: WEBHOOK,
        fetch,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ).resolves.toBe(true);

    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1_000, 3_000]);
  });

  it("does not retry a rejected request", async () => {
    const { fetch, calls } = recordingFetch(400);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(notifyNewFarmSite(site, { url: WEBHOOK, fetch, sleep: noSleep })).resolves.toBe(
      false,
    );

    expect(calls).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith(
      "[farmjs.telemetry.new-site-webhook]",
      "https://shop.example.com: HTTP 400",
    );
  });

  it("gives up after three network failures without logging the webhook URL", async () => {
    const { fetch, calls } = recordingFetch(new TypeError("fetch failed"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(notifyNewFarmSite(site, { url: WEBHOOK, fetch, sleep: noSleep })).resolves.toBe(
      false,
    );

    expect(calls).toHaveLength(3);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret-token");
  });
});
