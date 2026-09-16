import { expect, test } from "@playwright/test";

// Eligibility claims that reject isolation. The risk here is the opposite of a
// wrong grant: a claim that fails to fire would leave an unhydrated widget, so
// these assert the fallback happened and the widgets still work.

test("a client component from a package falls back and stays interactive", async ({ page }) => {
  await page.goto("/package-island");

  const button = page.getByTestId("package-button");
  await expect(button).toHaveText("press me");
  // Package boundaries cannot be isolated yet, so the page hydrates route-wide
  // and the button carries no marker of its own.
  await expect(page.locator("main farm-client-boundary")).toHaveCount(0);

  await button.click();
  await expect(button).toHaveText("package pressed");
});

for (const [route, names] of [
  ["/map-basic", ["alpha", "beta", "gamma"]],
  ["/map-helper", ["one", "two", "three"]],
] as const) {
  test(`data-dependent island counts fall back and stay interactive on ${route}`, async ({
    page,
  }) => {
    await page.goto(route);

    // The island count is not statically known, so the page hydrates route-wide.
    await expect(page.locator("main farm-client-boundary")).toHaveCount(0);

    // Each item still holds its own state.
    for (const name of names) {
      const item = page.getByTestId(`list-item-${name}`);
      await expect(item).toHaveText(`${name}: 0`);
      await item.click();
      await expect(item).toHaveText(`${name}: 1`);
    }
    // Clicking one item must not have advanced the others.
    await expect(page.getByTestId(`list-item-${names[0]}`)).toHaveText(`${names[0]}: 1`);
  });
}

test("layout islands keep isolating on the fallback routes", async ({ page }) => {
  for (const route of ["/package-island", "/map-basic", "/map-helper"]) {
    await page.goto(route);
    await expect(page.locator("header farm-client-boundary")).toHaveCount(2);
    const counter = page.locator("header").getByTestId("counter");
    await counter.click();
    await expect(counter).toHaveText("count: 1");
  }
});
