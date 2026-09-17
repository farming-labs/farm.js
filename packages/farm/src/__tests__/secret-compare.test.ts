// @vitest-environment node
import { describe, expect, it } from "vitest";
import { farmSecretsMatch } from "../secret-compare";
import { isCronRequestAuthorized } from "../cron";

describe("farmSecretsMatch", () => {
  it("accepts an exact match", () => {
    expect(farmSecretsMatch("s3cr3t-value", "s3cr3t-value")).toBe(true);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(farmSecretsMatch("s3cr3t-valuX", "s3cr3t-value")).toBe(false);
  });

  it("rejects a matching prefix", () => {
    expect(farmSecretsMatch("s3cr3t", "s3cr3t-value")).toBe(false);
  });

  it("rejects a value that is longer than the secret", () => {
    expect(farmSecretsMatch("s3cr3t-value-extra", "s3cr3t-value")).toBe(false);
  });

  it("never authorizes against an unset secret", () => {
    expect(farmSecretsMatch("", "")).toBe(false);
    expect(farmSecretsMatch("anything", "")).toBe(false);
  });

  it("rejects non-string input instead of coercing it", () => {
    expect(farmSecretsMatch(undefined as unknown as string, "secret")).toBe(false);
    expect(farmSecretsMatch("secret", null as unknown as string)).toBe(false);
  });

  it("inspects every position rather than stopping at the first difference", () => {
    // A first-character mismatch and a last-character mismatch must do the same
    // amount of work. Counting charCodeAt calls proves that structurally,
    // without asserting on wall-clock timing, which is far too noisy in CI.
    const secret = "abcdefghijklmnopqrstuvwxyz";
    const original = String.prototype.charCodeAt;

    const countCalls = (guess: string): number => {
      let calls = 0;
      String.prototype.charCodeAt = function (this: string, index: number) {
        calls += 1;
        return original.call(this, index);
      };
      try {
        expect(farmSecretsMatch(guess, secret)).toBe(false);
      } finally {
        String.prototype.charCodeAt = original;
      }
      return calls;
    };

    const failsFirst = countCalls("Xbcdefghijklmnopqrstuvwxyz");
    const failsLast = countCalls("abcdefghijklmnopqrstuvwxyX");

    expect(failsFirst).toBeGreaterThan(0);
    expect(failsFirst).toBe(failsLast);
  });
});

describe("cron secret authorization", () => {
  function requestWith(headers: Record<string, string>): Request {
    return new Request("https://example.com/api/cron/nightly", { headers });
  }

  it("authorizes a correct bearer secret", () => {
    const request = requestWith({ authorization: "Bearer top-secret" });
    expect(isCronRequestAuthorized(request, { secret: "top-secret" })).toBe(true);
  });

  it("authorizes a correct x-farm-cron-secret header", () => {
    const request = requestWith({ "x-farm-cron-secret": "top-secret" });
    expect(isCronRequestAuthorized(request, { secret: "top-secret" })).toBe(true);
  });

  it("rejects a secret that only shares a prefix", () => {
    const request = requestWith({ authorization: "Bearer top-sec" });
    expect(isCronRequestAuthorized(request, { secret: "top-secret" })).toBe(false);
  });

  it("rejects a request with no credentials when a secret is configured", () => {
    expect(isCronRequestAuthorized(requestWith({}), { secret: "top-secret" })).toBe(false);
  });
});
