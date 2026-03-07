import { expect, test } from "@playwright/test";

test.describe("Framework flows", () => {
  test("query parsing works in server-rendered query demo", async ({ page }) => {
    await page.goto("/query-demo?search=e2e&page=7&category=test&enabled=true&tags=a,b");
    await expect(page.getByText("Search:")).toBeVisible();
    await expect(page.getByText("e2e")).toBeVisible();
    await expect(page.getByText("Page:")).toBeVisible();
    await expect(page.getByText("7")).toBeVisible();
    await expect(page.getByText("Category:")).toBeVisible();
    await expect(page.getByText("test")).toBeVisible();
  });

  test("dynamic route params and query render correctly", async ({ page }) => {
    await page.goto("/users/123?tab=settings");
    await expect(page.getByText("User Profile: 123")).toBeVisible();
    await expect(page.getByText('"id": "123"')).toBeVisible();
    await expect(page.getByText('"tab": "settings"')).toBeVisible();
  });

  test("spa navigation through Link works", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "About" }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole("heading", { name: "About .js" })).toBeVisible();
  });
});
