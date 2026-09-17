// @vitest-environment node
import { describe, expect, it } from "vitest";
import { farmAcceptQuality, requestAcceptsMarkdown } from "../markdown";

describe("farmAcceptQuality", () => {
  it("returns 1 for an entry with no explicit quality", () => {
    expect(farmAcceptQuality("text/markdown", "text/markdown")).toBe(1);
  });

  it("returns the declared quality", () => {
    expect(farmAcceptQuality("text/html,text/markdown;q=0.4", "text/markdown")).toBe(0.4);
  });

  it("treats q=0 as not acceptable", () => {
    // RFC 9110: q=0 means the client refuses the type. Substring matching
    // cannot see this, which is the bug this helper exists to prevent.
    expect(farmAcceptQuality("text/html,text/markdown;q=0", "text/markdown")).toBe(0);
  });

  it("ignores wildcards unless they are requested", () => {
    expect(farmAcceptQuality("*/*", "text/markdown")).toBe(0);
    expect(farmAcceptQuality("*/*", "text/markdown", { wildcards: true })).toBe(1);
    expect(farmAcceptQuality("text/*", "text/markdown", { wildcards: true })).toBe(1);
  });

  it("does not match on substrings", () => {
    expect(farmAcceptQuality("application/x-text/markdown-ish", "text/markdown")).toBe(0);
  });

  it("takes the highest quality when a type is listed more than once", () => {
    expect(farmAcceptQuality("text/plain;q=0.2,text/plain;q=0.8", "text/plain")).toBe(0.8);
  });

  it("ignores a malformed quality instead of treating it as acceptable", () => {
    expect(farmAcceptQuality("text/markdown;q=abc", "text/markdown")).toBe(0);
  });

  it("returns 0 for an absent header", () => {
    expect(farmAcceptQuality(null, "text/markdown")).toBe(0);
    expect(farmAcceptQuality(undefined, "text/markdown")).toBe(0);
  });
});

// Mirrors docs/handler.ts shouldReturnMarkdown, minus the `.md` path check.
function negotiatesMarkdown(accept: string | null): boolean {
  const markdown = Math.max(
    farmAcceptQuality(accept, "text/markdown"),
    farmAcceptQuality(accept, "text/plain"),
  );
  if (markdown <= 0) return false;
  return markdown >= farmAcceptQuality(accept, "text/html", { wildcards: true });
}

describe("docs markdown negotiation", () => {
  it("serves markdown to a client that asks for it", () => {
    expect(negotiatesMarkdown("text/markdown")).toBe(true);
    expect(negotiatesMarkdown("text/plain")).toBe(true);
  });

  it("honors an explicit refusal", () => {
    expect(negotiatesMarkdown("text/html,text/markdown;q=0")).toBe(false);
  });

  it("keeps html for a client that only tolerates plain text", () => {
    expect(negotiatesMarkdown("text/html,text/plain;q=0.1,*/*;q=0.01")).toBe(false);
  });

  it("keeps html for ordinary browsers", () => {
    expect(
      negotiatesMarkdown(
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      ),
    ).toBe(false);
  });

  it("keeps html for a client that will take anything", () => {
    // `*/*` is not a preference for Markdown, so curl and friends keep the page.
    expect(negotiatesMarkdown("*/*")).toBe(false);
  });

  it("serves markdown when it outranks html", () => {
    expect(negotiatesMarkdown("text/html;q=0.2,text/markdown;q=0.9")).toBe(true);
  });
});

describe("requestAcceptsMarkdown stays intact", () => {
  it("matches an exact entry and respects q=0", () => {
    expect(requestAcceptsMarkdown("text/markdown")).toBe(true);
    expect(requestAcceptsMarkdown("text/markdown;q=0")).toBe(false);
    expect(requestAcceptsMarkdown("text/html")).toBe(false);
    expect(requestAcceptsMarkdown(null)).toBe(false);
  });
});
