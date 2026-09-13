import { expect, test } from "@playwright/test";

test("loads real Wasm on demand in the page and workers, recovers from traps, and releases workers", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const assets: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname.endsWith(".wasm") &&
      response.headers()["content-type"]?.includes("application/wasm")
    ) {
      expect(response.ok()).toBe(true);
      assets.push(response.url());
    }
  });
  await page.goto("./");
  const result = page.locator(".result");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Same module.Two places to run.",
  );
  expect(assets).toEqual([]);
  await page.getByRole("button", { name: "Run in browser" }).click();
  await expect(result).toHaveText("Browser result: 42");
  await page.getByLabel("First number").fill("-5");
  await page.getByLabel("Second number").fill("12");
  for (let run = 0; run < 2; run++) {
    await page.getByRole("button", { name: "Run in worker" }).click();
    await expect(result).toHaveText("Worker result: 7");
    await expect.poll(() => page.workers().length).toBe(0);
  }
  await page.getByRole("button", { name: "Test Wasm error" }).click();
  await expect(result).toContainText("Wasm error:");
  await expect(result).toHaveAttribute("data-error", "true");
  await expect.poll(() => page.workers().length).toBe(0);
  await page.getByRole("button", { name: "Run in worker" }).click();
  await expect(result).toHaveText("Worker result: 7");
  await expect.poll(() => page.workers().length).toBe(0);
  await page.getByRole("button", { name: "Run in browser" }).click();
  await expect(result).toHaveText("Browser result: 7");
  expect(assets.length).toBeGreaterThan(0);
  if (testInfo.project.name === "production") {
    await expect(page).toHaveURL(/\/lab$/);
    // Farm intentionally serves hashed assets at the origin root, even when
    // page routes use basePath (also used by its immutable cache routes).
    expect(assets.every((url) => new URL(url).pathname.startsWith("/assets/"))).toBe(true);
  }
  expect(errors).toEqual([]);
});

for (const mode of ["browser", "worker"]) {
  test(`handles a missing binary in the ${mode}`, async ({ page, context }) => {
    let blocked = false;
    await context.route(/\.wasm(?:\?|$)/, async (route) => {
      if (route.request().resourceType() === "fetch") {
        blocked = true;
        await route.fulfill({
          status: 404,
          contentType: "text/plain",
          body: "Missing Wasm fixture",
        });
      } else {
        await route.continue();
      }
    });
    await page.goto("./");
    await page.getByRole("button", { name: `Run in ${mode}` }).click();
    await expect(page.locator(".result")).toContainText("Wasm error:");
    expect(blocked).toBe(true);
    await expect(page.getByRole("button", { name: `Run in ${mode}` })).toBeEnabled();
    await expect.poll(() => page.workers().length).toBe(0);
  });
}

test("keeps the demo usable at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("./");
  await page.getByRole("button", { name: "Run in worker" }).click();
  await expect(page.locator(".result")).toHaveText("Worker result: 42");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
