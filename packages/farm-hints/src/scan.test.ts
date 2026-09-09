import { beforeEach, describe, expect, it } from "vitest";
import { resolveHintsOptions } from "./config.js";
import { collectDocumentHints, createSelector } from "./scan.js";

describe("document hint scanners", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
    document.body.innerHTML = "";
  });

  it("finds HTML, layout-risk, and third-party script problems", async () => {
    document.body.innerHTML = `
      <main>
        <p id="repeated">First</p>
        <p id="repeated">Second</p>
        <button data-testid="outer"><a href="/details">Details</a></button>
        <img src="/tractor.png" alt="A tractor">
      </main>
    `;
    const external = document.createElement("script");
    external.src = "https://cdn.example.test/widget.js";
    document.head.append(external);

    const issues = await collectDocumentHints(
      document,
      window,
      resolveHintsOptions({ accessibility: false }),
    );

    expect(issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(["html:duplicate-id:repeated", "performance:image-size:main > img"]),
    );
    expect(issues.some((issue) => issue.id.startsWith("html:nested-interactive"))).toBe(true);
    expect(issues.some((issue) => issue.id.startsWith("third-party:script:"))).toBe(true);
  });

  it("allows trusted third-party origins", async () => {
    const external = document.createElement("script");
    external.src = "https://cdn.example.test/widget.js";
    external.defer = true;
    document.head.append(external);

    const issues = await collectDocumentHints(
      document,
      window,
      resolveHintsOptions({
        accessibility: false,
        performance: false,
        html: false,
        thirdParty: { allow: ["cdn.example.test"] },
      }),
    );
    expect(issues).toEqual([]);
  });

  it("does not repeat a nested-control finding already reported by axe", async () => {
    document.body.innerHTML = `<button class="outer-control"><a href="/details">Details</a></button>`;

    const issues = await collectDocumentHints(
      document,
      window,
      resolveHintsOptions({
        accessibility: { rules: { "color-contrast": { enabled: false } } },
        performance: false,
        thirdParty: false,
      }),
    );

    expect(issues.some((issue) => issue.id.startsWith("accessibility:nested-interactive:"))).toBe(
      true,
    );
    expect(issues.some((issue) => issue.id.startsWith("html:nested-interactive:"))).toBe(false);
  });

  it("creates stable, readable selectors", () => {
    document.body.innerHTML = `<main><section><button>One</button><button>Two</button></section></main>`;
    expect(createSelector(document.querySelectorAll("button")[1])).toBe(
      "main > section > button:nth-of-type(2)",
    );
  });
});
