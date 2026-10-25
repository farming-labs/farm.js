import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import farmingLabsLogoUrl from "../../assets/farming-labs-logo-dark.svg?url";
import { AgentCheckMadeWith } from "./check-made-with";

const render = (report: {
  farm: boolean;
  framework?: string | null;
  farmVersion?: string | null;
}) => renderToStaticMarkup(createElement(AgentCheckMadeWith, { report }));

describe("what a checked site is made with", () => {
  it("gives a Farm.js site the Farming Labs mark, linking home", () => {
    for (const html of [render({ farm: true }), render({ farm: false, framework: "Farm.js" })]) {
      expect(html).toContain('href="/"');
      expect(html).toContain('aria-label="Made with Farm.js"');
      expect(html).toContain('data-tip="Made with Farm.js"');
      // The site header's Farming Labs logo (Vite may inline it as a data URI).
      const src = farmingLabsLogoUrl.replaceAll("&", "&amp;").replaceAll("'", "&#x27;");
      expect(html).toContain(`<img alt="" aria-hidden="true" src="${src}"/>`);
    }
  });
  it("names the Farm.js version when the site's manifest does", () => {
    const html = render({ farm: true, framework: "Farm.js", farmVersion: "0.1.35" });
    expect(html).toContain('aria-label="Made with Farm.js 0.1.35"');
    expect(html).toContain('data-tip="Made with Farm.js 0.1.35"');
    expect(render({ farm: true, farmVersion: null })).toContain('data-tip="Made with Farm.js"');
  });
  it("gives a framework the check recognizes its own mark, readable on black", () => {
    const next = render({ farm: false, framework: "Next.js" });
    expect(next).toContain('role="img" aria-label="Made with Next.js"');
    expect(next).not.toContain("<a ");
    // Next.js is black; on the page's black it is drawn in the text color.
    expect(next).toContain('fill="#ededed"');
    expect(render({ farm: false, framework: "Nuxt" })).toContain('fill="#00DC82"');
    expect(render({ farm: false, framework: "SvelteKit" })).toContain(
      'aria-label="Made with SvelteKit"',
    );
  });
  it("shows nothing for an unknown framework or none", () => {
    expect(render({ farm: false, framework: "Mystery CMS" })).toBe("");
    expect(render({ farm: false, framework: null })).toBe("");
    expect(render({ farm: false })).toBe("");
  });
});
