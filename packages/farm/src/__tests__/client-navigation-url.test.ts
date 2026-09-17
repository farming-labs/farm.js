// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isFarmExternalNavigationURL, resolveFarmNavigationURL } from "../client/navigation-url";

const DOCUMENT_URL = "https://app.example.test/products/list?page=3#top";

describe("client navigation URL resolution", () => {
  it("resolves relative references against the document, not the origin", () => {
    // Every one of these silently landed on "/" when the origin was the base.
    const cases: Array<[string, string]> = [
      ["?tab=2", "/products/list"],
      ["#details", "/products/list"],
      ["details", "/products/details"],
      ["./details", "/products/details"],
      ["../archive", "/archive"],
    ];

    for (const [href, expectedPathname] of cases) {
      const url = resolveFarmNavigationURL(href, DOCUMENT_URL);
      expect(url.pathname, `pathname for ${href}`).toBe(expectedPathname);
    }
  });

  it("keeps the query and hash the caller asked for", () => {
    expect(resolveFarmNavigationURL("?tab=2", DOCUMENT_URL).search).toBe("?tab=2");
    expect(resolveFarmNavigationURL("#details", DOCUMENT_URL).hash).toBe("#details");
    // A bare query drops the previous hash, matching anchor behaviour.
    expect(resolveFarmNavigationURL("?tab=2", DOCUMENT_URL).hash).toBe("");
  });

  it("leaves absolute paths and absolute URLs unchanged", () => {
    expect(resolveFarmNavigationURL("/dashboard", DOCUMENT_URL).pathname).toBe("/dashboard");
    expect(resolveFarmNavigationURL("/dashboard?a=1", DOCUMENT_URL).search).toBe("?a=1");
    expect(resolveFarmNavigationURL("https://other.test/x", DOCUMENT_URL).href).toBe(
      "https://other.test/x",
    );
  });

  it("still classifies cross-origin targets as external", () => {
    const origin = new URL(DOCUMENT_URL).origin;
    const internal = resolveFarmNavigationURL("details", DOCUMENT_URL);
    const external = resolveFarmNavigationURL("https://other.test/x", DOCUMENT_URL);

    expect(isFarmExternalNavigationURL(internal, origin)).toBe(false);
    expect(isFarmExternalNavigationURL(external, origin)).toBe(true);
  });
});
