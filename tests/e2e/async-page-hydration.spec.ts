import { expect, test } from "@playwright/test";

test.describe("Async server pages importing client components", () => {
  test("server-rendered HTML survives instead of blanking to an async client component error", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/async-client-import");
    await expect(page.getByTestId("async-page-title")).toHaveText("Async server page");
    await expect(page.getByTestId("async-page-data")).toHaveText("Fetched stars: 42");

    // The original bug hydrated the whole route module, React rejected the
    // async component, and the page blanked while re-running its fetches.
    // Give any deferred hydration a moment to run, then assert the server
    // HTML is still on screen and React raised no async-component errors.
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("async-page-title")).toHaveText("Async server page");
    await expect(page.getByTestId("star-button")).toBeVisible();

    const asyncComponentErrors = consoleErrors.filter(
      (text) =>
        text.includes("async Client Component") ||
        text.includes("suspended by an uncached promise"),
    );
    expect(asyncComponentErrors).toEqual([]);
  });

  test("async pages with client imports opt out of route hydration", async ({ request }) => {
    const response = await request.get("/async-client-import");
    expect(response.status()).toBe(200);

    const html = await response.text();
    expect(html).toContain("window.__FARM_PAGE_SHOULD_HYDRATE__ = false");
    expect(html).toContain("Fetched stars:");
  });
});
