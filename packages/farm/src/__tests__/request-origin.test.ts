// @vitest-environment node

import { describe, expect, it } from "vitest";
import { matchesAllowedOrigin, matchesHostHeader } from "../request-origin";
import { resolveFarmRequestURL } from "../server/request";
import {
  ServerActionRequestError,
  resolveServerActionsConfig,
  validateServerActionRequest,
} from "../server-action-security";
import type { FarmRequest } from "../types";

// A proxy may rewrite the host (via X-Forwarded-Host) while preserving the
// scheme, or terminate TLS and leave the upstream socket speaking plain HTTP.
// `matchesHostHeader` is the fallback reached when `sourceOrigin ===
// requestUrl.origin` does not short-circuit. Its documented contract (see the
// JSDoc on `matchesHostHeader`) is: host matches the `Host` header *and*
// scheme matches the rebuilt `request.url` scheme. These tests pin that
// contract at the function boundary so a future maintainer cannot relax the
// scheme check (protocol-downgrade CSRF) or re-introduce a JSDoc that
// over-promises proxy-rewrite support.

describe("matchesHostHeader", () => {
  it("accepts a host rewrite that preserves the scheme", () => {
    const request = new Request("https://internal.local/action", {
      headers: { host: "app.example.com" },
    });
    expect(matchesHostHeader("https://app.example.com", request)).toBe(true);
  });

  it("rejects a scheme rewrite (TLS offload) when request.url is http:", () => {
    const request = new Request("http://app.example.com/action", {
      headers: { host: "app.example.com" },
    });
    expect(matchesHostHeader("https://app.example.com", request)).toBe(false);
  });

  it("accepts an exact same-origin request where host and scheme both match request.url", () => {
    const request = new Request("https://app.example.com/action", {
      headers: { host: "app.example.com" },
    });
    expect(matchesHostHeader("https://app.example.com", request)).toBe(true);
  });

  it("rejects a protocol-downgrade same-host request", () => {
    const request = new Request("https://app.example.com/action", {
      headers: { host: "app.example.com" },
    });
    expect(matchesHostHeader("http://app.example.com", request)).toBe(false);
  });

  it("rejects a cross-host origin that matches neither Host nor request.url host", () => {
    const request = new Request("https://app.example.com/action", {
      headers: { host: "app.example.com" },
    });
    expect(matchesHostHeader("https://attacker.example", request)).toBe(false);
  });

  it("rejects when no Host header is present", () => {
    const request = new Request("https://app.example.com/action");
    expect(request.headers.get("host")).toBeNull();
    expect(matchesHostHeader("https://app.example.com", request)).toBe(false);
  });

  it("rejects unparseable input without throwing", () => {
    const request = new Request("https://app.example.com/action", {
      headers: { host: "app.example.com" },
    });
    expect(() => matchesHostHeader("not a valid url", request)).not.toThrow();
    expect(matchesHostHeader("not a valid url", request)).toBe(false);
  });

  it("is case-insensitive on the Host header", () => {
    const request = new Request("https://app.example.com/action", {
      headers: { host: "APP.Example.COM" },
    });
    expect(matchesHostHeader("https://app.example.com", request)).toBe(true);
  });
});

describe("allowedOrigins mitigation for TLS-terminating proxies", () => {
  // request.url stays http: (proxy did not rewrite, trustProxy off or no
  // X-Forwarded-Proto) while the browser origin is https:. The short-circuit
  // and matchesHostHeader both fail on the scheme mismatch; the JSDoc-named
  // mitigation is to add the browser origin to serverActions.allowedOrigins.
  function tlsOffloadActionRequest(host = "app.example.com"): Request {
    return new Request(`http://${host}/action`, {
      method: "POST",
      headers: {
        origin: `https://${host}`,
        host,
        "sec-fetch-site": "same-origin",
        "content-type": "text/plain",
      },
    });
  }

  it("rejects the TLS-offload POST without an allowed origin", () => {
    expect(() =>
      validateServerActionRequest(tlsOffloadActionRequest(), resolveServerActionsConfig(undefined)),
    ).toThrow(expect.objectContaining({ code: "INVALID_ORIGIN", status: 403 }));
  });

  it("accepts the same TLS-offload POST when the browser origin is allowed", () => {
    const cfg = resolveServerActionsConfig({ allowedOrigins: ["https://app.example.com"] });
    expect(() => validateServerActionRequest(tlsOffloadActionRequest(), cfg)).not.toThrow();
  });

  it("still rejects the TLS-offload POST for a non-allowed origin", () => {
    const cfg = resolveServerActionsConfig({ allowedOrigins: ["https://other.example.com"] });
    expect(() => validateServerActionRequest(tlsOffloadActionRequest(), cfg)).toThrow(
      ServerActionRequestError,
    );
  });

  it("matchesAllowedOrigin honors an exact allowed origin for the https browser origin", () => {
    expect(matchesAllowedOrigin("https://app.example.com", "https://app.example.com")).toBe(true);
    expect(matchesAllowedOrigin("https://app.example.com", "https://other.example.com")).toBe(
      false,
    );
  });
});

describe("trustProxy + X-Forwarded-Proto rebuilds request.url to https:", () => {
  // The other JSDoc-named mitigation is enabling trustProxy with a proxy that
  // emits X-Forwarded-Proto: https. resolveFarmRequestURL then rebuilds the
  // URL with the https scheme, so validateServerActionRequest short-circuits
  // on sourceOrigin === requestUrl.origin and never reaches matchesHostHeader.
  function farmRequest(extraHeaders: Record<string, string> = {}): FarmRequest {
    return {
      method: "POST",
      url: "/action",
      headers: { host: "app.example.com", ...extraHeaders },
      socket: { encrypted: false },
    } as unknown as FarmRequest;
  }

  it("leaves request.url as http: when trustProxy is off (TLS offload, no rewrite)", () => {
    const url = resolveFarmRequestURL(farmRequest({ "x-forwarded-proto": "https" }));
    expect(url.origin).toBe("http://app.example.com");
  });

  it("rewrites request.url to https: when trustProxy is on and X-Forwarded-Proto: https", () => {
    const url = resolveFarmRequestURL(farmRequest({ "x-forwarded-proto": "https" }), {
      trustProxy: true,
    });
    expect(url.origin).toBe("https://app.example.com");
  });

  it("accepts the request via the exact-origin short-circuit after the rebuild", () => {
    const rebuiltUrl = resolveFarmRequestURL(farmRequest({ "x-forwarded-proto": "https" }), {
      trustProxy: true,
    });
    const request = new Request(rebuiltUrl, {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        host: "app.example.com",
        "sec-fetch-site": "same-origin",
        "content-type": "text/plain",
      },
    });

    expect(request.url).toBe("https://app.example.com/action");
    expect(() =>
      validateServerActionRequest(request, resolveServerActionsConfig(undefined)),
    ).not.toThrow();
  });

  it("rejects the same shape when trustProxy is off (matchesHostHeader fallback hits the scheme mismatch)", () => {
    const rebuiltUrl = resolveFarmRequestURL(farmRequest({ "x-forwarded-proto": "https" }));
    const request = new Request(rebuiltUrl, {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        host: "app.example.com",
        "sec-fetch-site": "same-origin",
        "content-type": "text/plain",
      },
    });

    expect(request.url).toBe("http://app.example.com/action");
    expect(() =>
      validateServerActionRequest(request, resolveServerActionsConfig(undefined)),
    ).toThrow(expect.objectContaining({ code: "INVALID_ORIGIN", status: 403 }));
  });
});
