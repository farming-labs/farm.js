import { describe, expect, it } from "vitest";
import {
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
    );

    expect(result.url).toBe("https://farm.test/account?tab=profile");
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
