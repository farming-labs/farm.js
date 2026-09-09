import { describe, expect, it } from "vitest";
import { resolveHintsOptions } from "./config.js";
import { collectDocumentHints } from "./scan.js";

describe("accessibility hints", () => {
  it("runs axe against the rendered page and keeps actionable details", async () => {
    document.documentElement.lang = "en";
    document.body.innerHTML = `<main><button class="save-icon"><svg aria-hidden="true"></svg></button></main>`;

    const issues = await collectDocumentHints(
      document,
      window,
      resolveHintsOptions({ performance: false, html: false, thirdParty: false }),
    );
    const buttonName = issues.find((issue) => issue.id.startsWith("accessibility:button-name:"));

    expect(buttonName).toMatchObject({
      category: "accessibility",
      severity: "critical",
      selector: "button",
    });
    expect(buttonName?.detail.length).toBeLessThanOrEqual(320);
    expect(buttonName?.helpUrl).toMatch(/^https:\/\//);
  });
});
