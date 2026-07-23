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
  await expect(page.getByText("Benchmarks", { exact: true }).first()).toBeVisible();

  const benchmarkResults = page.getByRole("region", {
    name: /Framework benchmark results/,
  });
  await expect(benchmarkResults).toBeVisible();
  for (const framework of ["Farm.js", "Next.js", "SvelteKit", "Nuxt", "TanStack Start"]) {
    await expect(benchmarkResults.getByRole("row", { name: new RegExp(framework) })).toBeVisible();
  }

  await page.getByRole("link", { name: "Get Started", exact: true }).first().click();

  await expect(page).toHaveURL(/\/docs\/getting-started$/);
  await expect(page.getByRole("heading", { name: "Getting Started", level: 1 })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
