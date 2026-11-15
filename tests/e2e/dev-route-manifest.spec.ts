import { expect, test, type Page } from "@playwright/test";

// A development document inlines the client manifest entries its own page boots with, not every
// route's: at 1,000 routes the whole manifest was about 650 KB per page. A navigation to a route
// the document did not inline still runs in the same document.

type InlinedManifest = { routes: string[]; layouts: string[]; module?: string };

function readInlinedManifest(page: Page): Promise<InlinedManifest> {
  return page.evaluate(() => {
    const manifest = (window as any).__FARM_MANIFEST__;
    return {
      routes: Object.keys(manifest.routes),
      layouts: Object.keys(manifest.layouts),
      module: manifest.module,
    };
  });
}

test("dev navigation reaches routes the document did not inline", async ({ page, request }) => {
  const html = await (await request.get("/")).text();
  const inlinedSource = html.match(/window\.__FARM_MANIFEST__ = (.*);\n/)?.[1];
  expect(inlinedSource).toBeDefined();
  // The page's own route and layout, plus the routes with search options Link reads as it renders.
  const inlinedRoutes = Object.keys(JSON.parse(inlinedSource!).routes);
  expect(inlinedRoutes).toContain("/");
  expect(inlinedRoutes).not.toContain("/about");
  expect(inlinedRoutes.length).toBeLessThanOrEqual(3);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  const inlined = await readInlinedManifest(page);
  expect(inlined.module).toBe("/@farm/manifest");
  expect(inlined.layouts).toEqual(["/"]);
  await page.evaluate(() => ((window as any).__sameDocument = true));

  await page.locator('nav a[href="/about"]').click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { level: 1, name: /About/ })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { level: 1, name: /About/ })).toBeVisible();

  expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);

  // An unknown route still renders the not-found page.
  await page.evaluate(() => (window as any).__FARM_SPA_ROUTER__.navigate("/no-such-route-e2e"));
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  expect(errors).toEqual([]);
});
