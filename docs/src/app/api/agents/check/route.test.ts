// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// Reports come back with the newest Farm.js release, read from npm.
vi.mock("../../../../lib/farm-latest", () => ({ latestFarmVersion: async () => "0.1.35" }));

const fetchMock = vi.fn<typeof fetch>();
const scan = {
  id: "abc123def456",
  createdAt: "2026-10-19T20:47:00.000Z",
  report: { url: "https://vercel.com/", score: 83, checks: [] },
};
const originalUrl = process.env.FARMJS_API_URL;
const originalKey = process.env.FARMJS_API_KEY;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  process.env.FARMJS_API_URL = "https://infra.test/";
  process.env.FARMJS_API_KEY = "farmjs_test-key";
  fetchMock.mockReset();
  // Starting a scan answers with its id, and the saved report reads back.
  fetchMock.mockImplementation(async (input) =>
    String(input).includes("/api/reports/")
      ? Response.json(scan)
      : Response.json({ id: "abc123def456" }, { status: 201 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  restore("FARMJS_API_URL", originalUrl);
  restore("FARMJS_API_KEY", originalKey);
});

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://farmjs.dev/api/agents/check", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function formRequest(url: string) {
  return new Request("https://farmjs.dev/api/agents/check", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ url }),
  });
}

describe("agent-ready check proxy", () => {
  it("starts a scan with the service key and the visitor's address", async () => {
    const response = await POST(
      jsonRequest({ url: " vercel.com " }, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "abc123def456",
      scan: { ...scan, latestFarmVersion: "0.1.35" },
    });
    const [target, init] = fetchMock.mock.calls[0]!;
    expect(target).toBe("https://infra.test/api/scans");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ url: "vercel.com" }));
    expect(init?.headers).toMatchObject({
      authorization: "Bearer farmjs_test-key",
      "x-farm-client-address": "203.0.113.7",
    });
  });

  it("sends no visitor address without a key, since the service would not trust it", async () => {
    delete process.env.FARMJS_API_KEY;
    await POST(jsonRequest({ url: "vercel.com" }, { "x-real-ip": "203.0.113.7" }));

    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers["x-farm-client-address"]).toBeUndefined();
  });

  it("redirects a form post to the check for its site, with the report's id in a cookie", async () => {
    const response = await POST(formRequest("vercel.com"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://farmjs.dev/agents/check?url=https%3A%2F%2Fvercel.com%2F",
    );
    expect(response.headers.get("set-cookie")).toBe(
      "agent_check_report=abc123def456; Path=/agents/check; Max-Age=600; HttpOnly; SameSite=Lax; Secure",
    );
  });

  it("sends a form post back with an error when the report can't be read", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).includes("/api/reports/")
        ? Response.json({ error: "not_found" }, { status: 404 })
        : Response.json({ id: "abc123def456" }, { status: 201 }),
    );
    const response = await POST(formRequest("vercel.com"));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/agents/check");
    expect(location.searchParams.get("error")).toBe("unavailable");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sends a failed form post back to the form with the error and the url", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "120" } }),
    );
    const response = await POST(formRequest("vercel.com"));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/agents/check");
    expect(location.searchParams.get("error")).toBe("rate_limited");
    expect(location.searchParams.get("url")).toBe("vercel.com");
  });

  it("passes a rate limit through with its retry-after", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "120" } }),
    );
    const response = await POST(jsonRequest({ url: "vercel.com" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" });
  });

  it("rejects a missing url and an oversized body without calling the service", async () => {
    expect((await POST(jsonRequest({}))).status).toBe(400);
    expect((await POST(jsonRequest({ url: "x".repeat(9000) }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses Farm.js Infrastructure when no API origin is set", async () => {
    delete process.env.FARMJS_API_URL;
    delete process.env.FARMJS_API_KEY;
    const response = await POST(jsonRequest({ url: "vercel.com" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "abc123def456",
      scan: { ...scan, latestFarmVersion: "0.1.35" },
    });
    const [target, init] = fetchMock.mock.calls[0]!;
    expect(target).toBe("https://app.farmjs.dev/api/scans");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });

  it("returns the finished report so the page can show it in place", async () => {
    const response = await POST(jsonRequest({ url: "vercel.com" }));
    await expect(response.json()).resolves.toEqual({
      id: "abc123def456",
      scan: { ...scan, latestFarmVersion: "0.1.35" },
    });
    expect(fetchMock.mock.calls[1]![0]).toBe("https://infra.test/api/reports/abc123def456");
  });

  it("answers 502 when the report can't be read, since the page has nothing to show", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).includes("/api/reports/")
        ? Response.json({ error: "not_found" }, { status: 404 })
        : Response.json({ id: "abc123def456" }, { status: 201 }),
    );
    const response = await POST(jsonRequest({ url: "vercel.com" }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "unavailable" });
  });

  it("answers 503 when the service is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const response = await POST(jsonRequest({ url: "vercel.com" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "unavailable" });
  });
});
