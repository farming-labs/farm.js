import { expect, test, type Page } from "@playwright/test";

const LOADING_FALLBACKS =
  '[data-testid="root-loading-boundary"], [data-testid="route-loading-boundary"]';

type LoadingWindow = Window & { __farmLoadingFallbackInsertions?: number };

// loading.tsx is a Suspense fallback. Count every time one enters the DOM, since a
// fallback that is inserted and revealed a frame later still reaches the screen.
async function countLoadingFallbackInsertions(page: Page) {
  await page.addInitScript((selector) => {
    const win = window as LoadingWindow;
    win.__farmLoadingFallbackInsertions = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof Element)) continue;
          if (node.matches(selector) || node.querySelector(selector)) {
            win.__farmLoadingFallbackInsertions = (win.__farmLoadingFallbackInsertions || 0) + 1;
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  }, LOADING_FALLBACKS);

  return {
    reset: () =>
      page.evaluate(() => {
        (window as LoadingWindow).__farmLoadingFallbackInsertions = 0;
      }),
    read: () => page.evaluate(() => (window as LoadingWindow).__farmLoadingFallbackInsertions),
  };
}

async function expectInteractiveCounter(page: Page) {
  const counter = page.getByTestId("navigation-loading-counter");
  await expect(async () => {
    await counter.click();
    await expect(counter).not.toHaveText(/clicks: 0$/, { timeout: 500 });
  }).toPass();
}

test.describe("Route loading boundaries during client navigation", () => {
  test("navigating between ready routes never inserts the loading.tsx fallback", async ({
    page,
  }) => {
    const fallbacks = await countLoadingFallbackInsertions(page);
    await page.goto("/navigation-loading/first");
    await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
    await expectInteractiveCounter(page);
    // The streamed document load may show loading.tsx; only navigations count.
    await fallbacks.reset();

    await page.getByTestId("navigation-loading-link").click();
    await expect(page).toHaveURL(/\/navigation-loading\/second$/);
    await expect(page.getByTestId("navigation-loading-second")).toBeVisible();
    await expectInteractiveCounter(page);

    await page.getByTestId("navigation-loading-anchor").click();
    await expect(page).toHaveURL(/\/navigation-loading\/first$/);
    await expect(page.getByTestId("navigation-loading-first")).toBeVisible();
    await expectInteractiveCounter(page);

    await page.goBack();
    await expect(page.getByTestId("navigation-loading-second")).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId("navigation-loading-first")).toBeVisible();
    await expectInteractiveCounter(page);

    expect(await fallbacks.read()).toBe(0);
  });

  test("a slow route arrives whole instead of flashing loading.tsx after the wait", async ({
    page,
  }) => {
    const fallbacks = await countLoadingFallbackInsertions(page);
    await page.goto("/navigation-loading/first");
    await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
    await expectInteractiveCounter(page);
    await fallbacks.reset();

    await page.evaluate(() => {
      void (window as any).__FARM_SPA_ROUTER__.navigate("/boundaries/loading");
    });
    // The navigation response is rendered to completion on the server (2.5s here),
    // so the current page stays until it arrives and the route then shows complete.
    await expect(page.getByTestId("navigation-loading-first")).toBeVisible();
    await expect(page.getByTestId("route-loading-final")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("navigation-loading-first")).toHaveCount(0);

    expect(await fallbacks.read()).toBe(0);
  });
});
