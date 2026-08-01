import { expect, test } from "@playwright/test";

const routes = [
  ["/", "React Server Components"],
  ["/about", "About React Server Components"],
  ["/counter", "Client Components"],
  ["/form", "Server Actions"],
  ["/server-fn-middleware", "Server function middleware"],
  ["/server-query", "Unified server queries"],
  ["/after", "Post-response work"],
  ["/static-content", "Automatic optimized boundaries"],
] as const;

test("all RSC example pages render successfully with the optimized boundary enabled", async ({
  page,
}) => {
  for (const [route, heading] of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
});

test("ordinary JSX is automatically rendered through a safe optimized boundary", async ({
  page,
}) => {
  const response = await page.goto("/static-content?view=details");
  expect(response?.status()).toBe(200);

  const fragment = page.locator('article[data-static-content="automatic"]');
  await expect(fragment).toHaveAttribute("data-strata", /^[a-f0-9]{64}$/);
  await expect(fragment.locator("section")).toHaveCount(36);
  await expect(fragment.locator("section").first()).toContainText(
    "streaming without React-owned interior nodes",
  );
  await expect(fragment).toContainText(
    '<script>globalThis.__strataInjected = true</script> & "quotes".',
  );
  await expect(fragment.getByRole("link", { name: "Read the Strata source" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );

  expect(
    await page.evaluate(
      () => (globalThis as typeof globalThis & { __strataInjected?: boolean }).__strataInjected,
    ),
  ).toBeUndefined();
});

test("switching optimized content preserves surrounding client state", async ({ page }) => {
  await page.goto("/static-content?view=summary");

  const counter = page.getByRole("heading", { name: "Interactive Counter" }).locator("..");
  const value = counter.locator("span.text-4xl");
  await counter.getByRole("button", { name: "+", exact: true }).click();
  await expect(value).toHaveText("1");

  await page.locator('[data-view-link="details"]').click();
  await expect(page).toHaveURL(/\/static-content\?view=details$/);
  await expect(page.locator('article[data-static-content="automatic"]')).toHaveAttribute(
    "data-strata",
    /^[a-f0-9]{64}$/,
  );
  await expect(value).toHaveText("1");

  await page.locator('[data-view-link="summary"]').click();
  await expect(page).toHaveURL(/\/static-content\?view=summary$/);
  await expect(page.locator('article[data-static-content="automatic"]')).toBeVisible();
  await expect(value).toHaveText("1");
});
