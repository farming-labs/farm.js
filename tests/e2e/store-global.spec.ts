import { expect, test, type Page } from "@playwright/test";

async function readRenderCount(page: Page, testId: string) {
  const text = await page.getByTestId(testId).textContent();
  return Number(text?.split(":")[1]);
}

test.describe("Global store", () => {
  test("shares state globally and only rerenders subscribed views", async ({ page }) => {
    await page.goto("/store-e2e");
    await expect(page.getByTestId("hydrated")).toHaveText("yes");

    await expect(page.getByTestId("theme-value")).toHaveText("light");
    await expect(page.getByTestId("sidebar-value")).toHaveText("false");

    const initialWhole = await readRenderCount(page, "whole-renders");
    const initialTheme = await readRenderCount(page, "theme-renders");
    const initialSidebar = await readRenderCount(page, "sidebar-renders");
    const initialPair = await readRenderCount(page, "pair-renders");

    await page.getByTestId("toggle-sidebar").click();

    await expect(page.getByTestId("sidebar-value")).toHaveText("true");
    await expect(page.getByTestId("pair-value")).toContainText('"sidebar":true');

    const afterSidebarWhole = await readRenderCount(page, "whole-renders");
    const afterSidebarTheme = await readRenderCount(page, "theme-renders");
    const afterSidebarSidebar = await readRenderCount(page, "sidebar-renders");
    const afterSidebarPair = await readRenderCount(page, "pair-renders");

    expect(afterSidebarWhole).toBeGreaterThan(initialWhole);
    expect(afterSidebarSidebar).toBeGreaterThan(initialSidebar);
    expect(afterSidebarPair).toBeGreaterThan(initialPair);
    expect(afterSidebarTheme).toBe(initialTheme);

    await page.getByTestId("toggle-theme").click();

    await expect(page.getByTestId("theme-value")).toHaveText("dark");
    await expect(page.getByTestId("pair-value")).toContainText('"theme":"dark"');

    const afterThemeWhole = await readRenderCount(page, "whole-renders");
    const afterThemeTheme = await readRenderCount(page, "theme-renders");
    const afterThemeSidebar = await readRenderCount(page, "sidebar-renders");
    const afterThemePair = await readRenderCount(page, "pair-renders");

    expect(afterThemeWhole).toBeGreaterThan(afterSidebarWhole);
    expect(afterThemeTheme).toBeGreaterThan(afterSidebarTheme);
    expect(afterThemePair).toBeGreaterThan(afterSidebarPair);
    expect(afterThemeSidebar).toBe(afterSidebarSidebar);
  });
});
