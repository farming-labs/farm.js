import { expect, test, type Page } from "@playwright/test";

// /prefetch-e2e/static has no client component, so its Links never hydrate. The router prefetches
// them from the mode each Link writes into its HTML.

/** Paths the router prefetched: dev page data (`/__farm/page-data?path=`), or production HTML. */
function trackPrefetches(page: Page): string[] {
  const prefetched: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") return;
    const url = new URL(request.url());
    if (url.pathname === "/__farm/page-data") {
      prefetched.push(url.searchParams.get("path") ?? "");
    } else if (request.resourceType() === "fetch") {
      prefetched.push(url.pathname + url.search);
    }
  });
  return prefetched;
}

async function openStaticPage(page: Page) {
  await page.goto("/prefetch-e2e/static");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  // The page is server HTML only: nothing on it hydrates.
  expect(await page.evaluate(() => (window as any).__FARM_HYDRATED__ === true)).toBe(false);
}

test.describe("Link prefetch on a page that does not hydrate", () => {
  test("follows each Link's mode", async ({ page }) => {
    const prefetched = trackPrefetches(page);
    await openStaticPage(page);

    await expect.poll(() => prefetched.includes("/about?static=render")).toBe(true);
    expect(prefetched).not.toContain("/about?static=intent");
    expect(prefetched).not.toContain("/about?static=viewport");

    // The none link is hovered first and has the same delay, so it would be in by now.
    await page.getByTestId("static-none").hover();
    await page.getByTestId("static-intent").hover();
    await expect.poll(() => prefetched.includes("/about?static=intent")).toBe(true);
    expect(prefetched).not.toContain("/about?static=none");

    await page.getByTestId("static-viewport").scrollIntoViewIfNeeded();
    await expect.poll(() => prefetched.includes("/about?static=viewport")).toBe(true);
  });

  test("prefetches the Links of a page a client navigation brings in", async ({ page }) => {
    const prefetched = trackPrefetches(page);
    await openStaticPage(page);
    await page.evaluate(() => ((window as any).__farmSameDocument = true));

    await page.getByTestId("static-home").click();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => (window as any).__farmSameDocument)).toBe(true);
    // The home page's Links use the default mode, intent and viewport, and are in view.
    await expect.poll(() => prefetched.includes("/contact")).toBe(true);
  });

  test("a hydrated Link still makes one request per prefetch", async ({ page }) => {
    const prefetched = trackPrefetches(page);
    await page.goto("/prefetch-e2e");
    await expect(page.getByTestId("hydrated")).toHaveText("yes");
    const count = (path: string) => prefetched.filter((entry) => entry === path).length;

    // The Link and the router's handler both schedule this one; the router drops the duplicate.
    await page.getByTestId("link-intent").hover();
    await expect.poll(() => count("/about?mode=intent")).toBe(1);
    // A later link with the same delay: once it is in, a duplicate of the first would be too.
    await page.getByTestId("link-hover-legacy").hover();
    await expect.poll(() => count("/about?mode=hover-legacy")).toBe(1);
    expect(count("/about?mode=intent")).toBe(1);
  });
});
