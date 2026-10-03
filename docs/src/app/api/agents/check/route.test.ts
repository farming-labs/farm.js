// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const fetchMock = vi.fn<typeof fetch>();
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
  fetchMock.mockResolvedValue(Response.json({ id: "abc123def456" }, { status: 201 }));
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
    await expect(response.json()).resolves.toEqual({ id: "abc123def456" });
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

  it("redirects a form post to the report", async () => {
    const response = await POST(formRequest("vercel.com"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://farmjs.dev/agents/check/abc123def456");
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

  it("answers 503 when the service is not configured or unreachable", async () => {
    delete process.env.FARMJS_API_URL;
    expect((await POST(jsonRequest({ url: "vercel.com" }))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.FARMJS_API_URL = "https://infra.test";
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const response = await POST(jsonRequest({ url: "vercel.com" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "unavailable" });
  });
});
