// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyMarkdownNegotiationHeaders, resolveMarkdownConfig } from "../markdown";
import { applyProductionMiddlewareHeaders } from "../middleware/production-runtime";
import { compressFarmResponse } from "../plugins/compression";
import { editFarmResponseHeaders, isFarmOwnedResponse, ownFarmResponse } from "../response-headers";

const html = (headers: Record<string, string> = {}) =>
  new Response("<p>page</p>", {
    status: 201,
    statusText: "Created",
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });

describe("Farm-owned response headers", () => {
  it("edits a response Farm built in place", () => {
    const response = ownFarmResponse(html());
    const output = editFarmResponseHeaders(response, (headers) => headers.set("x-edit", "1"));
    expect(output).toBe(response);
    expect(output.headers.get("x-edit")).toBe("1");
  });

  it("copies any other response and leaves it untouched", async () => {
    const original = html({ "set-cookie": "a=1" });
    original.headers.append("set-cookie", "b=2");
    const output = editFarmResponseHeaders(original, (headers) => headers.set("x-edit", "1"));

    expect(output).not.toBe(original);
    expect(original.headers.has("x-edit")).toBe(false);
    expect(output.headers.get("x-edit")).toBe("1");
    expect(output.status).toBe(201);
    expect(output.statusText).toBe("Created");
    expect(output.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(output.body).toBe(original.body);
    // The copy is Farm's own, so the next header-only step edits it in place.
    expect(isFarmOwnedResponse(output)).toBe(true);
    expect(editFarmResponseHeaders(output, (headers) => headers.set("x-next", "1"))).toBe(output);
    expect(await output.text()).toBe("<p>page</p>");
  });

  it("copies an immutable response instead of throwing", async () => {
    const immutable = await fetch("data:text/html,<p>immutable</p>");
    const output = editFarmResponseHeaders(immutable, (headers) => headers.set("x-edit", "1"));
    expect(output).not.toBe(immutable);
    expect(output.headers.get("x-edit")).toBe("1");
  });

  describe("header-only pipeline steps", () => {
    const markdown = (response: Response) =>
      applyMarkdownNegotiationHeaders(response, {
        config: resolveMarkdownConfig({ enabled: true }),
        pathname: "/docs",
      });
    const vary = (response: Response) =>
      compressFarmResponse(
        new Request("https://farm.test/", { headers: { "accept-encoding": "identity" } }),
        response,
      );
    const middleware = (response: Response) =>
      applyProductionMiddlewareHeaders(response, new Headers({ "x-middleware": "1" }));

    it.each([
      ["Markdown negotiation", markdown, "link"],
      ["compression Vary", vary, "vary"],
      ["middleware headers", middleware, "x-middleware"],
    ] as const)("%s edits a Farm-built response in place", (_label, step, header) => {
      const response = ownFarmResponse(html());
      const output = step(response);
      expect(output).toBe(response);
      expect(output.headers.has(header)).toBe(true);
    });

    it.each([
      ["Markdown negotiation", markdown, "link"],
      ["compression Vary", vary, "vary"],
      ["middleware headers", middleware, "x-middleware"],
    ] as const)("%s never mutates a response Farm did not build", (_label, step, header) => {
      const original = html();
      const output = step(original);
      expect(output).not.toBe(original);
      expect(original.headers.has(header)).toBe(false);
      expect(output.headers.has(header)).toBe(true);
    });
  });
});
