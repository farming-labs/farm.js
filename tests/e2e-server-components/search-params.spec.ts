import { expect, test } from "@playwright/test";

test("a page reads searchParams with and without await, on either engine", async ({ page }) => {
  await page.goto("/search?token=abc&then=x");
  await expect(page.getByTestId("search-direct")).toHaveText("abc");
  await expect(page.getByTestId("search-awaited")).toHaveText("abc");
  await page.goto("/search");
  await expect(page.getByTestId("search-direct")).toHaveText("none");
});
