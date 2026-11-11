import { expect, test, type Page } from "@playwright/test";

// Development navigation reads page data; the production router reads HTML and
// hands a redirect to a document load (production-redirect-navigation.spec.ts).
// Both must land on the target with the same history, without console errors.
const isProduction = process.env.FARM_E2E_MODE === "prod";

async function openRedirectLab(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/redirect-e2e");
  await expect(page.getByTestId("hydrated")).toHaveText("yes");
  // A document load discards this marker; client navigation keeps it.
  await page.evaluate(() => {
    (window as Window & { __farmRedirectE2EDocument?: boolean }).__farmRedirectE2EDocument = true;
  });
  return errors;
}

function keptDocument(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as Window & { __farmRedirectE2EDocument?: boolean }).__farmRedirectE2EDocument ===
      true,
  );
}

for (const [link, from] of [
  ["Page redirect", "render"],
  ["Async page redirect", "async"],
  ["Middleware redirect", "middleware"],
] as const) {
  test(`a Link whose target redirects (${from}) lands on the redirect target`, async ({ page }) => {
    const errors = await openRedirectLab(page);

    await page.getByRole("link", { name: link, exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/redirect-e2e/target\\?from=${from}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Redirect target");
    if (!isProduction) expect(await keptDocument(page)).toBe(true);

    // The redirecting URL never got a history entry: Back returns to the
    // page the navigation started from, and Forward to the target.
    await page.goBack();
    await expect(page).toHaveURL(/\/redirect-e2e$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Redirect navigation");
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/redirect-e2e/target\\?from=${from}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Redirect target");
    if (!isProduction) expect(await keptDocument(page)).toBe(true);

    expect(errors).toEqual([]);
  });
}
