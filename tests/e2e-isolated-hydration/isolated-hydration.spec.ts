import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const SERVER_ONLY_LAYOUT_TOKEN = "FARM_E2E_SERVER_ONLY_LAYOUT_TOKEN";
const exampleRoot = path.resolve(__dirname, "../../examples/isolated-hydration");

function collectClientScripts(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectClientScripts(full));
    } else if (/\.(js|mjs)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

test("server layout renders but stays out of the client bundle", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-server-token", SERVER_ONLY_LAYOUT_TOKEN);
  await expect(page.locator("body")).toHaveAttribute("data-catalog-count", "3");

  const scripts = collectClientScripts(path.join(exampleRoot, ".farm/.output/public"));
  expect(scripts.length).toBeGreaterThan(0);
  for (const file of scripts) {
    expect(readFileSync(file, "utf8"), `${file} must not include layout code`).not.toContain(
      SERVER_ONLY_LAYOUT_TOKEN,
    );
  }
});

test("emits one boundary marker per island with its strategy", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("farm-client-boundary")).toHaveCount(4);
  for (const strategy of ["load", "interaction", "visible", "idle"]) {
    await expect(
      page.locator(`farm-client-boundary[data-farm-island-strategy="${strategy}"]`),
    ).toHaveCount(1);
  }
});

test("load island hydrates immediately with its serialized props", async ({ page }) => {
  await page.goto("/");
  const container = page.locator('farm-client-boundary[data-farm-island-strategy="load"]');
  await expect(container).toHaveAttribute("data-farm-hydrated", "true");

  const counter = page.getByTestId("counter");
  await expect(counter).toHaveText("count: 0");
  await counter.click();
  await counter.click();
  await expect(counter).toHaveText("count: 2");
});

test("interaction island hydrates on first click and replays it", async ({ page }) => {
  await page.goto("/");
  const container = page.locator('farm-client-boundary[data-farm-island-strategy="interaction"]');
  const loadContainer = page.locator('farm-client-boundary[data-farm-island-strategy="load"]');
  // Wait until the eager island is done so the next check is not a race.
  await expect(loadContainer).toHaveAttribute("data-farm-hydrated", "true");
  await expect(container).not.toHaveAttribute("data-farm-hydrated", "true");

  const dismiss = page.getByTestId("dismiss");
  await expect(dismiss).toHaveText("dismiss me");
  await dismiss.click();
  // The click that triggered hydration is replayed once after the root mounts.
  await expect(dismiss).toHaveText("dismissed");
  await expect(container).toHaveAttribute("data-farm-hydrated", "true");
});

test("visible island waits for viewport entry", async ({ page }) => {
  await page.goto("/");
  const container = page.locator('farm-client-boundary[data-farm-island-strategy="visible"]');
  const loadContainer = page.locator('farm-client-boundary[data-farm-island-strategy="load"]');
  await expect(loadContainer).toHaveAttribute("data-farm-hydrated", "true");
  await expect(container).not.toHaveAttribute("data-farm-hydrated", "true");

  await page.getByTestId("visible").scrollIntoViewIfNeeded();
  await expect(container).toHaveAttribute("data-farm-hydrated", "true");
  await page.getByTestId("visible").click();
  await expect(page.getByTestId("visible")).toHaveText("visible: clicked");
});

test("idle island hydrates after idle without any interaction", async ({ page }) => {
  await page.goto("/");
  const container = page.locator('farm-client-boundary[data-farm-island-strategy="idle"]');
  // requestIdleCallback carries a 2s timeout fallback in the runtime.
  await expect(container).toHaveAttribute("data-farm-hydrated", "true", { timeout: 10_000 });
  await page.getByTestId("idle").click();
  await expect(page.getByTestId("idle")).toHaveText("idle: clicked");
});

test("layout island state survives client navigation", async ({ page }) => {
  await page.goto("/");
  const counter = page.getByTestId("counter");
  await counter.click();
  await counter.click();
  await expect(counter).toHaveText("count: 2");

  await page.evaluate(() => {
    (window as { __farmE2eNoReload?: boolean }).__farmE2eNoReload = true;
  });
  await page.getByRole("link", { name: "about" }).click();
  await expect(page.getByTestId("about-title")).toBeVisible();
  // Guard: the navigation must have been client-side, not a full reload.
  expect(
    await page.evaluate(() => (window as { __farmE2eNoReload?: boolean }).__farmE2eNoReload),
  ).toBe(true);
  await expect(page.getByTestId("counter")).toHaveText("count: 2");
});
