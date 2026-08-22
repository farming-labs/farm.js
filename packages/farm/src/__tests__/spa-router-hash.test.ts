/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { getHashTargetElement } from "../client/spa-router";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("getHashTargetElement", () => {
  it("finds ids that are invalid CSS selectors", () => {
    document.body.innerHTML = `<h2 id="2-installation">Installation</h2><p id="a.b">dots</p>`;

    expect(getHashTargetElement("#2-installation")?.id).toBe("2-installation");
    expect(getHashTargetElement("#a.b")?.id).toBe("a.b");
  });

  it("decodes percent-encoded fragments", () => {
    document.body.innerHTML = `<h2 id="é">accent</h2>`;

    expect(getHashTargetElement("#%C3%A9")?.id).toBe("é");
  });

  it("keeps the raw fragment when percent-encoding is malformed", () => {
    document.body.innerHTML = `<h2 id="100%">raw</h2>`;

    expect(getHashTargetElement("#100%")?.id).toBe("100%");
  });

  it("falls back to anchor names", () => {
    document.body.innerHTML = `<a name="legacy-anchor">old-style</a>`;

    expect(getHashTargetElement("#legacy-anchor")).not.toBeNull();
  });

  it("returns null without throwing when nothing matches", () => {
    expect(getHashTargetElement("#missing")).toBeNull();
    expect(getHashTargetElement("#")).toBeNull();
  });
});
