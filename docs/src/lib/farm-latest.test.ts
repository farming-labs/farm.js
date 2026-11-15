// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createLatestFarmVersion } from "./farm-latest";

function registry(answers: Array<() => Promise<Response>>) {
  const calls: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    return next();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const latest = (version: unknown) => async () => Response.json({ name: "@farm.js/core", version });

describe("latest Farm.js release", () => {
  it("reads npm's latest dist-tag and keeps it for five minutes", async () => {
    let time = 0;
    const { fetch, calls } = registry([latest("0.1.35"), latest("0.1.36")]);
    const lookup = createLatestFarmVersion({ fetch, now: () => time, fallback: "0.0.1" });
    expect(await lookup()).toBe("0.1.35");
    time += 4 * 60_000;
    expect(await lookup()).toBe("0.1.35");
    expect(calls).toEqual(["https://registry.npmjs.org/@farm.js/core/latest"]);
    time += 2 * 60_000;
    expect(await lookup()).toBe("0.1.36");
    expect(calls).toHaveLength(2);
  });

  it("asks once for lookups that arrive together", async () => {
    const { fetch, calls } = registry([latest("0.1.35")]);
    const lookup = createLatestFarmVersion({ fetch, fallback: "0.0.1" });
    expect(await Promise.all([lookup(), lookup(), lookup()])).toEqual([
      "0.1.35",
      "0.1.35",
      "0.1.35",
    ]);
    expect(calls).toHaveLength(1);
  });

  it("falls back to this site's Farm.js version, and retries after a minute", async () => {
    let time = 0;
    const { fetch, calls } = registry([
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => new Response("rate limited", { status: 429 }),
      latest("not a version"),
      async () => new Response("<html>", { headers: { "content-type": "text/html" } }),
      latest("0.1.35"),
    ]);
    const lookup = createLatestFarmVersion({ fetch, now: () => time, fallback: "0.1.34" });
    for (let attempt = 0; attempt < 4; attempt++) {
      expect(await lookup()).toBe("0.1.34");
      expect(await lookup()).toBe("0.1.34");
      time += 61_000;
    }
    expect(calls).toHaveLength(4);
    expect(await lookup()).toBe("0.1.35");
  });
});
