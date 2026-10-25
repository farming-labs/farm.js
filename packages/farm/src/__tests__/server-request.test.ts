import { describe, expect, it } from "vitest";
import { createServerFn } from "../server-fn";
import { createServerQuery } from "../server-query";
import {
  _getRequestReadCount,
  _runWithCurrentRequest,
  createWebRequestFromFarmRequest,
  getCurrentRequest,
} from "../server/request";
import type { FarmRequest } from "../types";

function request(headers: FarmRequest["headers"], url = "/account?tab=profile"): FarmRequest {
  return { method: "GET", url, headers } as FarmRequest;
}

describe("createWebRequestFromFarmRequest", () => {
  it("uses the first value from comma-separated forwarded headers", () => {
    const result = createWebRequestFromFarmRequest(
      request({
        host: "internal:3000",
        "x-forwarded-host": "app.example.com, internal:3000",
        "x-forwarded-proto": "https, http",
      }),
      { trustProxy: true },
    );

    expect(result.url).toBe("https://app.example.com/account?tab=profile");
  });

  it("uses the first value from array forwarded headers", () => {
    const result = createWebRequestFromFarmRequest(
      request({
        host: "internal:3000",
        "x-forwarded-host": ["app.example.com", "internal:3000"],
        "x-forwarded-proto": ["https", "http"],
      }),
      { trustProxy: true },
    );

    expect(result.url).toBe("https://app.example.com/account?tab=profile");
  });

  it("falls back safely for malformed forwarded origins", () => {
    const result = createWebRequestFromFarmRequest(
      request({
        host: "farm.test",
        "x-forwarded-host": "not a valid host",
        "x-forwarded-proto": "javascript",
      }),
      { trustProxy: true },
    );

    expect(result.url).toBe("http://farm.test/account?tab=profile");
  });

  it("accepts case-insensitive protocols and rejects host delimiters", () => {
    const result = createWebRequestFromFarmRequest(
      request({
        host: "farm.test",
        "x-forwarded-host": "evil.test/path",
        "x-forwarded-proto": "HTTPS",
      }),
      { trustProxy: true },
    );

    expect(result.url).toBe("https://farm.test/account?tab=profile");
  });

  it("ignores forwarded authority unless trustProxy is enabled", () => {
    const direct = createWebRequestFromFarmRequest(
      request({
        host: "farm.test",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
      }),
    );
    const proxied = createWebRequestFromFarmRequest(
      request({
        host: "internal:3000",
        "x-forwarded-host": "app.example.com",
        "x-forwarded-proto": "https",
      }),
      { trustProxy: true },
    );

    expect(direct.url).toBe("http://farm.test/account?tab=profile");
    expect(proxied.url).toBe("https://app.example.com/account?tab=profile");
  });

  it("uses the trusted context origin for middleware Request conversion", () => {
    const result = createWebRequestFromFarmRequest(
      request({ host: "internal:3000", "x-forwarded-host": "ignored.example" }),
      { origin: "https://app.example.com" },
    );

    expect(result.url).toBe("https://app.example.com/account?tab=profile");
  });
});

describe("server request store", () => {
  it("exposes the current request during server execution", async () => {
    const current = new Request("https://farmjs.dev/server-demo", {
      headers: {
        cookie: "demo=1",
      },
    });

    await _runWithCurrentRequest(current, async () => {
      const result = getCurrentRequest();
      expect(result.url).toBe("https://farmjs.dev/server-demo");
      expect(result.headers.get("cookie")).toBe("demo=1");
    });
  });

  it("throws when no request context is active", () => {
    expect(() => getCurrentRequest()).toThrow("No current request is available");
  });
});

describe("server function request reads", () => {
  // A render that reads the request through a server function or server query is per-visitor
  // too: PPR and ISR compare the read count across the render.
  it("counts header reads, not the hand-over", async () => {
    const outer = new Request("https://farm.test/page", { headers: { "x-user": "alice" } });
    const seen: Request[] = [];
    const quiet = createServerFn({
      handler: ({ request }) => {
        seen.push(request!);
        return "hello";
      },
    });
    const reader = createServerFn({ handler: ({ request }) => request?.headers.get("x-user") });
    const query = createServerQuery({
      key: () => ["server-request-read-test"],
      handler: ({ request }) => request?.headers.get("x-user"),
    });

    await _runWithCurrentRequest(outer, async () => {
      await expect(quiet(undefined)).resolves.toBe("hello");
      await quiet(undefined);
      expect(_getRequestReadCount(outer)).toBe(0);
      // A real Request, the same one for every call in this request.
      expect(seen[0]).toBeInstanceOf(Request);
      expect(seen[1]).toBe(seen[0]);
      expect(new Request(seen[0]!).url).toBe(outer.url);
      expect(_getRequestReadCount(outer)).toBe(0);

      await expect(reader(undefined)).resolves.toBe("alice");
      expect(_getRequestReadCount(outer)).toBe(1);
      await expect(query(undefined)).resolves.toBe("alice");
      expect(_getRequestReadCount(outer)).toBe(2);
    });
  });
});
