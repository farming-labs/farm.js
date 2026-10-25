// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyMarkdownNegotiationHeaders, resolveMarkdownConfig } from "../markdown";
import { applyProductionMiddlewareHeaders } from "../middleware/production-runtime";
import {
  _isFarmOwnedResponse,
  _markFarmOwnedResponse,
  _withFarmResponseHeaders,
} from "../owned-response";

const html = () =>
  new Response("<html><body>page</body></html>", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

describe("owned responses", () => {
  it("edits a response Farm owns in place, without touching its body", () => {
    const response = _markFarmOwnedResponse(html());
    const body = response.body;

    const result = _withFarmResponseHeaders(response, (headers) => headers.set("x-step", "1"));

    expect(result).toBe(response);
    expect(result.body).toBe(body);
    expect(result.headers.get("x-step")).toBe("1");
  });

  it("copies a response from app code and leaves the original unchanged", async () => {
    const response = html();

    const result = _withFarmResponseHeaders(response, (headers) => headers.set("x-step", "1"));

    expect(result).not.toBe(response);
    expect(response.headers.get("x-step")).toBeNull();
    expect(result.headers.get("x-step")).toBe("1");
    expect(_isFarmOwnedResponse(response)).toBe(false);
    // The copy is Farm's, so the next step edits it in place.
    expect(_isFarmOwnedResponse(result)).toBe(true);
    expect(await result.text()).toBe("<html><body>page</body></html>");
  });

  it("falls back to a copy when an owned response has immutable headers", () => {
    const redirect = _markFarmOwnedResponse(Response.redirect("https://example.com/next", 307));

    const result = _withFarmResponseHeaders(redirect, (headers) => headers.set("x-step", "1"));

    expect(result).not.toBe(redirect);
    expect(result.status).toBe(307);
    expect(result.headers.get("location")).toBe("https://example.com/next");
    expect(result.headers.get("x-step")).toBe("1");
  });

  it("never accumulates headers on an app Response reused across requests", () => {
    // A module-level Response an API route returns on every request.
    const shared = new Response(null, { status: 204, headers: { "x-app": "1" } });
    const config = resolveMarkdownConfig(undefined);
    const middlewareHeaders = new Headers({ "x-from-middleware": "yes" });

    for (let request = 0; request < 3; request++) {
      const out = applyProductionMiddlewareHeaders(shared, middlewareHeaders);
      expect(out).not.toBe(shared);
      expect(out.headers.get("x-from-middleware")).toBe("yes");
    }
    // 204 is not HTML, so markdown negotiation leaves it alone.
    expect(applyMarkdownNegotiationHeaders(shared, { config, pathname: "/" })).toBe(shared);
    expect([...shared.headers]).toEqual([["x-app", "1"]]);
  });

  it("adds markdown negotiation headers once per owned page response", () => {
    const config = resolveMarkdownConfig(undefined);
    const first = applyMarkdownNegotiationHeaders(_markFarmOwnedResponse(html()), {
      config,
      pathname: "/",
    });
    const second = applyMarkdownNegotiationHeaders(_markFarmOwnedResponse(html()), {
      config,
      pathname: "/",
    });

    for (const response of [first, second]) {
      expect(response.headers.get("link")).toBe(
        '</index.md>; rel="alternate"; type="text/markdown"',
      );
      expect(response.headers.get("vary")).toBe("Accept");
    }
  });
});
