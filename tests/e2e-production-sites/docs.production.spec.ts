import { access } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.beforeAll(async () => {
  await Promise.all([
    access("docs/.farm/.output/server/index.mjs"),
    access("docs/.farm/.output/public/farm-client.js"),
  ]);
});

test("boots the emitted docs site and navigates into the guide", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));

  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  await expect(page).toHaveTitle(/Farm\.js/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/a framework for/i);
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();

  const getStarted = page.getByRole("link", { name: "Get Started", exact: true }).first();
  await expect(getStarted).toBeVisible();
  await getStarted.click();

  await expect(page).toHaveURL(/\/docs\/getting-started$/);
  await expect(page.getByRole("heading", { name: "Getting Started", level: 1 })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
