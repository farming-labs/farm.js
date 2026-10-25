// @vitest-environment node

import type { RequestMiddlewareContext } from "@farm.js/core/middleware";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

// Reports come back with the newest Farm.js release, read from npm.
vi.mock("../../../lib/farm-latest", () => ({ latestFarmVersion: async () => "0.1.35" }));

const fetchMock = vi.fn<typeof fetch>();
const scan = {
  id: "abc123def456",
  createdAt: "2026-10-19T20:47:00.000Z",
  report: { url: "https://vercel.com/", score: 83, checks: [] },
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) =>
    String(input).endsWith("/api/reports/abc123def456")
      ? Response.json(scan)
      : Response.json({ error: "not_found" }, { status: 404 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function run(path: string, { cookie, method = "GET" }: { cookie?: string; method?: string } = {}) {
  const url = new URL(path, "https://farmjs.dev");
  const data = new Map<string, unknown>();
  const headers = new Map<string, string>();
  const context = {
    url,
    pathname: url.pathname,
    searchParams: url.searchParams,
    method,
    data,
    headers,
    cookies: { get: (name: string) => (name === "agent_check_report" ? cookie : undefined) },
  } as unknown as RequestMiddlewareContext;
  return {
    data,
    headers,
    result: middleware(new Request(url, { method }), context as never),
  };
}

describe("agent check middleware", () => {
  it("sends an old report link to the check for its site", async () => {
    const response = (await run("/agents/check/abc123def456").result) as Response;
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://farmjs.dev/agents/check?url=https%3A%2F%2Fvercel.com%2F",
    );
  });

  it("sends an unknown or malformed report link to the check", async () => {
    for (const path of ["/agents/check/zzzzzzzzzzzz", "/agents/check/not-an-id"]) {
      const response = (await run(path).result) as Response;
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://farmjs.dev/agents/check");
    }
    // A malformed id never reaches the service.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a form post's report on the check for the same site", async () => {
    const { data, headers, result } = run("/agents/check?url=https%3A%2F%2Fvercel.com%2F", {
      cookie: "abc123def456",
    });
    expect(await result).toBeUndefined();
    expect(data.get("agentCheckScan")).toEqual({ ...scan, latestFarmVersion: "0.1.35" });
    expect(headers.get("cache-control")).toBe("private, no-store");
  });

  it("ignores the cookie for another site, and does nothing without one", async () => {
    const other = run("/agents/check?url=https%3A%2F%2Fexample.com%2F", { cookie: "abc123def456" });
    expect(await other.result).toBeUndefined();
    expect(other.data.size).toBe(0);

    const plain = run("/agents/check?url=https%3A%2F%2Fvercel.com%2F");
    expect(await plain.result).toBeUndefined();
    expect(plain.data.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
