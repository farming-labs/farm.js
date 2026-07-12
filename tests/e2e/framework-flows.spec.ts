import { expect, test } from "@playwright/test";

test.describe("Framework flows", () => {
  test("query parsing hydrates the client query-state demo", async ({ page }) => {
    await page.goto("/query-demo?search=e2e&page=7&category=test&enabled=true&tags=a,b");
    await expect(page.getByPlaceholder("Enter search term...")).toHaveValue("e2e");
    await expect(page.getByLabel("Enabled")).toBeChecked();
    await expect(page.getByText("Page 7 of 10")).toBeVisible();
    await expect(page.locator("span.bg-purple-100").filter({ hasText: "a" })).toBeVisible();
    await expect(page.locator("span.bg-purple-100").filter({ hasText: "b" })).toBeVisible();
  });

  test("dynamic route params and query render correctly", async ({ page }) => {
    await page.goto("/users/123?tab=settings");
    await expect(page.getByText("User Profile: 123")).toBeVisible();
    await expect(page.getByText('"id": "123"')).toBeVisible();
    await expect(page.getByText('"tab": "settings"')).toBeVisible();
  });

  test("spa navigation through Link works", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "About", exact: true }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole("heading", { name: "About .js" })).toBeVisible();
  });
});
