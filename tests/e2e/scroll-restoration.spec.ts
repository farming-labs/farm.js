import { expect, test, type Page } from "@playwright/test";

// Runs against `farm dev` (the SPA router) and the production build (the generated HTML router).

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

/** Click a nav link without Playwright scrolling it into view first. */
async function clickNav(page: Page, href: string, title: string) {
  await page.evaluate((target) => {
    document.querySelector<HTMLAnchorElement>(`nav a[href="${target}"]`)!.click();
  }, href);
  await expect(page).toHaveTitle(title);
}

test("back and forward restore each page's own scroll position", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  // The root element survives client navigations, so every page stays tall enough to scroll.
  await page.evaluate(() => {
    document.documentElement.style.minHeight = "6000px";
  });

  await page.evaluate(() => window.scrollTo(0, 1200));
  await clickNav(page, "/about", "About | Farm.js");
  await expect.poll(() => scrollY(page)).toBe(0);

  await page.evaluate(() => window.scrollTo(0, 300));
  await page.goBack();
  await expect(page).toHaveTitle("Home | Farm.js");
  await expect.poll(() => scrollY(page)).toBe(1200);

  await page.goForward();
  await expect(page).toHaveTitle("About | Farm.js");
  await expect.poll(() => scrollY(page)).toBe(300);
});
