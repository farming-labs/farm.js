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

  test("client components of an async page hydrate as islands", async ({ page }) => {
    await page.goto("/async-client-import");
    const island = page.locator("farm-client-boundary[data-farm-client-boundary]");
    await expect(island).toHaveCount(1);
    await expect(island).toHaveAttribute("data-farm-hydrated", "true");

    const button = page.getByTestId("star-button");
    await expect(button).toHaveText("Stars: 42");
    await button.click();
    await button.click();
    await expect(button).toHaveText("Stars: 44");
    await expect(page.getByTestId("async-page-title")).toHaveText("Async server page");
  });

  test("the async page itself never hydrates", async ({ request }) => {
    const response = await request.get("/async-client-import");
    expect(response.status()).toBe(200);

    // The route-wide flag is either emitted as false or omitted entirely; it
    // must never be true, because React cannot run the async page component.
    const html = await response.text();
    expect(html).not.toContain("window.__FARM_PAGE_SHOULD_HYDRATE__ = true");
    expect(html).toContain("Fetched stars:");
  });
});
