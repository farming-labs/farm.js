// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-chrome";
import { formatCount, loadSiteStats, resetSiteStatsForTests } from "./site-stats";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  resetSiteStatsForTests();
  document.body.innerHTML = "";
});

const githubLink = () => document.querySelector<HTMLAnchorElement>('a[title="GitHub"]')!;
const npmLink = () => document.querySelector<HTMLAnchorElement>('a[title="npm"]')!;

async function renderHeader() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SiteHeader));
  });
  // Let the stats request settle and the state update render.
  await act(async () => {
    await loadSiteStats();
  });
  return root;
}

describe("formatCount", () => {
  it("keeps small counts exact and shortens large ones", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(681)).toBe("681");
    expect(formatCount(1_000)).toBe("1k");
    expect(formatCount(5_531)).toBe("5.5k");
    expect(formatCount(22_404)).toBe("22k");
    expect(formatCount(1_250_000)).toBe("1.3M");
  });
});

describe("site header counters", () => {
  it("leaves counts out of the server HTML, so hydration matches", () => {
    const html = renderToStaticMarkup(createElement(SiteHeader));
    expect(html).toContain('aria-label="Open Farm.js on GitHub"');
    expect(html).toContain('href="https://www.npmjs.com/package/@farm.js/core"');
    expect(html).not.toContain("/wk");
  });

  it("shows stars and the best week of downloads once they load, named for screen readers", async () => {
    const fetch = vi.fn(async () => Response.json({ stars: 681, peakWeeklyDownloads: 8789 }));
    vi.stubGlobal("fetch", fetch);
    const root = await renderHeader();
    expect(githubLink().textContent).toBe("681");
    expect(githubLink().getAttribute("aria-label")).toBe("Farm.js on GitHub, 681 stars");
    expect(npmLink().textContent).toBe("8.8k/wk");
    expect(npmLink().getAttribute("aria-label")).toBe(
      "@farm.js/core on npm, 8.8k downloads in its best week",
    );
    expect(fetch).toHaveBeenCalledWith("/api/stats", expect.anything());
    act(() => root.unmount());
  });

  it("makes one request however many headers ask", async () => {
    const fetch = vi.fn(async () => Response.json({ stars: 1, peakWeeklyDownloads: 1 }));
    vi.stubGlobal("fetch", fetch);
    await Promise.all([loadSiteStats(), loadSiteStats()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("leaves out a count that isn't available", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ stars: null, peakWeeklyDownloads: 8789 }));
    const root = await renderHeader();
    expect(githubLink().textContent).toBe("");
    expect(githubLink().getAttribute("aria-label")).toBe("Open Farm.js on GitHub");
    expect(npmLink().textContent).toBe("8.8k/wk");
    act(() => root.unmount());
  });

  it("shows plain links when the request fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    const root = await renderHeader();
    expect(githubLink().textContent).toBe("");
    expect(npmLink().textContent).toBe("");
    act(() => root.unmount());
  });
});
