// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const originalToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
});

/** Daily counts as npm's range endpoint returns them, starting at `from`. */
function days(from: string, counts: number[]) {
  const start = Date.parse(from);
  return counts.map((downloads, index) => ({
    day: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    downloads,
  }));
}

function stubFetch(answer: (url: string) => Response | Error) {
  const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const result = answer(String(input));
    if (result instanceof Error) throw result;
    return result;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const npmRange = (url: string) =>
  /downloads\/range\/([^/]+)\/@farm\.js\/core$/.exec(url)?.[1] ?? null;

describe("GET /api/stats", () => {
  it("reports stars and the best week of downloads, not the latest one", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-08-12T12:00:00Z"), toFake: ["Date"] });
    // A launch spike (best 7 days: 900 + 1500 + 1200 + 800 + 700 + 600 + 300), then a
    // quieter latest week.
    const daily = [100, 900, 1500, 1200, 800, 700, 600, 300, 200, 200, 150, 150, 100, 100, 50];
    const fetch = stubFetch((url) => {
      if (url === "https://api.github.com/repos/farming-labs/farm.js")
        return Response.json({ stargazers_count: 681 });
      if (npmRange(url) === "2026-07-29:2026-08-12")
        return Response.json({ downloads: days("2026-07-29", daily) });
      return new Error(`unexpected ${url}`);
    });

    const response = await GET();
    expect(await response.json()).toEqual({ stars: 681, peakWeeklyDownloads: 6000 });
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    );
    // Unauthenticated unless the deployment provides a token.
    expect(fetch.mock.calls[0]![1]?.headers).not.toHaveProperty("authorization");
  });

  it("finds a peak week that spans two of npm's 18-month pages", async () => {
    vi.useFakeTimers({ now: Date.parse("2028-01-05T12:00:00Z"), toFake: ["Date"] });
    const requested: string[] = [];
    stubFetch((url) => {
      if (url.startsWith("https://api.github.com/")) return Response.json({ stargazers_count: 1 });
      const range = npmRange(url);
      if (!range) return new Error(`unexpected ${url}`);
      requested.push(range);
      const [from, to] = range.split(":") as [string, string];
      const length = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
      const counts = Array.from({ length }, () => 10);
      // 1000 a day for the last 3 days of the first page and the first 4 of the next.
      if (from === "2026-07-29") counts.fill(1000, length - 3);
      else counts.fill(1000, 0, 4);
      return Response.json({ downloads: days(from, counts) });
    });

    expect((await (await GET()).json()).peakWeeklyDownloads).toBe(7000);
    expect(requested).toEqual(["2026-07-29:2027-12-10", "2027-12-11:2028-01-05"]);
  });

  it("uses GITHUB_TOKEN when it is set", async () => {
    process.env.GITHUB_TOKEN = "fixture-token";
    const fetch = stubFetch((url) =>
      url.startsWith("https://api.github.com/")
        ? Response.json({ stargazers_count: 1 })
        : Response.json({ downloads: days("2026-07-29", [1]) }),
    );
    await GET();
    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({
      authorization: "Bearer fixture-token",
    });
  });

  it("reports an unavailable count as null and retries sooner", async () => {
    stubFetch((url) =>
      url.startsWith("https://api.github.com/")
        ? new Response("rate limited", { status: 403 })
        : Response.json({ downloads: [{ day: "2026-07-29", downloads: "lots" }] }),
    );
    const response = await GET();
    expect(await response.json()).toEqual({ stars: null, peakWeeklyDownloads: null });
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
  });

  it("never reports a peak from incomplete history", async () => {
    vi.useFakeTimers({ now: Date.parse("2028-01-05T12:00:00Z"), toFake: ["Date"] });
    stubFetch((url) => {
      if (url.startsWith("https://api.github.com/")) return Response.json({ stargazers_count: 9 });
      // The second page fails, so the peak could be missing a week: leave it out.
      return npmRange(url)?.startsWith("2026-07-29")
        ? Response.json({ downloads: days("2026-07-29", [5, 5, 5]) })
        : new TypeError("network down");
    });
    expect(await (await GET()).json()).toEqual({ stars: 9, peakWeeklyDownloads: null });
  });
});
