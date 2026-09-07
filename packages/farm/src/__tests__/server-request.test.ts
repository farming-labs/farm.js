import { describe, expect, it } from "vitest";
import { createWebRequestFromFarmRequest } from "../server/request";
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
});
