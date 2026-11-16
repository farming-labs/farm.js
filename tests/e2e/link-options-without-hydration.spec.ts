import { expect, test, type Page } from "@playwright/test";

// /link-options-e2e has no client component, so its Links never hydrate. The router's click
// handler navigates them with the options each Link writes into its HTML.

async function openStaticPage(page: Page) {
  await page.goto("/link-options-e2e");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  // The page is server HTML only: nothing on it hydrates.
  expect(await page.evaluate(() => (window as any).__FARM_HYDRATED__ === true)).toBe(false);
  await page.evaluate(() => ((window as any).__farmSameDocument = true));
}

/** Clicks a Link and waits until the router has finished that navigation, scrolling included. */
async function navigate(page: Page, testId: string, step: string) {
  await page.getByTestId(testId).click();
  await expect(page).toHaveURL(new RegExp(`\\?step=${step}$`));
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__FARM_SPA_ROUTER__.getNavigationState().pending),
    )
    .toBe(false);
  expect(await page.evaluate(() => (window as any).__farmSameDocument)).toBe(true);
}

const historyLength = (page: Page) => page.evaluate(() => history.length);
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test.describe("Link options on a page that does not hydrate", () => {
  test("replace swaps the history entry instead of adding one", async ({ page }) => {
    await openStaticPage(page);
    const start = await historyLength(page);

    await navigate(page, "link-push", "push");
    expect(await historyLength(page)).toBe(start + 1);

    await navigate(page, "link-replace", "replace");
    expect(await historyLength(page)).toBe(start + 1);
  });

  test("scroll={false} keeps the scroll position", async ({ page }) => {
    await openStaticPage(page);

    await page.getByTestId("link-scroll").scrollIntoViewIfNeeded();
    expect(await scrollY(page)).toBeGreaterThan(0);
    await navigate(page, "link-scroll", "top");
    expect(await scrollY(page)).toBe(0);

    await page.getByTestId("link-no-scroll").scrollIntoViewIfNeeded();
    const kept = await scrollY(page);
    expect(kept).toBeGreaterThan(0);
    await navigate(page, "link-no-scroll", "stay");
    expect(await scrollY(page)).toBe(kept);
  });

  test("viewTransition runs the navigation in a view transition", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__FARM_VIEW_TRANSITIONS__ = 0;
      (document as any).startViewTransition = (update: () => void | Promise<void>) => {
        (window as any).__FARM_VIEW_TRANSITIONS__ += 1;
        const updateCallbackDone = Promise.resolve().then(update);
        return {
          ready: Promise.resolve(),
          updateCallbackDone,
          finished: updateCallbackDone,
          skipTransition() {},
        };
      };
    });
    await openStaticPage(page);
    const transitions = () => page.evaluate(() => (window as any).__FARM_VIEW_TRANSITIONS__);

    await navigate(page, "link-push", "push");
    expect(await transitions()).toBe(0);

    await navigate(page, "link-transition", "transition");
    expect(await transitions()).toBe(1);
  });
});
