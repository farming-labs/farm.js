import { expect, test, type Locator, type Page } from "@playwright/test";

// examples/basic has a root layout plus two route groups beside it:
//   (auth)/layout.tsx  client layout around /sign-in and /sign-up
//   (shop)/layout.tsx  server layout around /cart
// A group adds no URL segment, so these layouts share the URL "/" with the root
// layout and are told apart by their directory.

const rootNav = (page: Page) => page.locator("nav").filter({ hasText: "Farm.js" }).first();

function layoutPatterns(html: string): string[] {
  return Array.from(html.matchAll(/data-farm-layout-pattern="([^"]*)"/g), (match) => match[1]!);
}

async function markNode(locator: Locator, marker: string): Promise<void> {
  await locator.evaluate((element, value) => {
    (element as unknown as Record<string, string>).__farmRouteGroupMarker = value;
  }, marker);
}

async function readMarker(locator: Locator): Promise<string | undefined> {
  return locator.evaluate(
    (element) => (element as unknown as Record<string, string>).__farmRouteGroupMarker,
  );
}

/** React attaches its props to the node once the layout has hydrated. */
async function waitForReactOwner(locator: Locator): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__react"))),
    )
    .toBe(true);
}

test.describe("route group layouts", () => {
  test("a group layout wraps only its own routes, inside the root layout", async ({ request }) => {
    for (const pathname of ["/sign-in", "/sign-up"]) {
      const response = await request.get(pathname);
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(layoutPatterns(html)).toEqual(["/", "/(auth)"]);
      expect(html).toContain('data-testid="auth-layout"');
      expect(html).not.toContain('data-testid="shop-layout"');
    }

    const cart = await (await request.get("/cart")).text();
    expect(layoutPatterns(cart)).toEqual(["/", "/(shop)"]);
    expect(cart).toContain('data-testid="shop-layout"');
    expect(cart).not.toContain('data-testid="auth-layout"');

    const about = await (await request.get("/about")).text();
    expect(layoutPatterns(about)).toEqual(["/"]);
    expect(about).not.toContain('data-testid="auth-layout"');
    expect(about).not.toContain('data-testid="shop-layout"');
  });

  test("navigating inside a group keeps its layout mounted with its state", async ({ page }) => {
    await page.goto("/sign-in");
    const authLayout = page.getByTestId("auth-layout");
    const counter = page.getByTestId("auth-layout-counter");
    await expect(page.getByTestId("auth-page")).toHaveText("Sign in");
    await expect(rootNav(page)).toBeVisible();
    await waitForReactOwner(counter);

    await counter.click();
    await expect(counter).toHaveText("Layout clicks: 1");
    await markNode(authLayout, "kept");

    await page.getByTestId("auth-link-sign-up").click();
    await expect(page).toHaveURL(/\/sign-up$/);
    await expect(page.getByTestId("auth-page")).toHaveText("Sign up");
    await expect(page).toHaveTitle("Sign up | Farm.js");
    expect(await readMarker(authLayout)).toBe("kept");
    await expect(counter).toHaveText("Layout clicks: 1");
    await expect(rootNav(page)).toBeVisible();

    await page.getByTestId("auth-link-sign-in").click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByTestId("auth-page")).toHaveText("Sign in");
    expect(await readMarker(authLayout)).toBe("kept");
    await expect(counter).toHaveText("Layout clicks: 1");
  });

  test("navigating to a sibling group swaps the group layout and keeps the root layout", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    const counter = page.getByTestId("auth-layout-counter");
    await waitForReactOwner(counter);
    await counter.click();
    await expect(counter).toHaveText("Layout clicks: 1");

    await page.getByTestId("auth-link-cart").click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("shop-page")).toHaveText("Cart");
    await expect(page.getByTestId("shop-layout")).toBeVisible();
    await expect(page.getByTestId("auth-layout")).toHaveCount(0);
    await expect(rootNav(page)).toBeVisible();

    // Leaving the group for an ungrouped page replaces only the group layout.
    await markNode(rootNav(page), "root");
    await page.getByTestId("cart-link-about").click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("About");
    await expect(page.getByTestId("shop-layout")).toHaveCount(0);
    expect(await readMarker(rootNav(page))).toBe("root");

    // Coming back into (auth) mounts its layout again, with fresh state.
    await page.goto("/cart");
    await page.getByTestId("shop-link-sign-in").click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByTestId("shop-layout")).toHaveCount(0);
    await expect(page.getByTestId("auth-layout")).toBeVisible();
    await expect(page.getByTestId("auth-layout-counter")).toHaveText("Layout clicks: 0");
  });
});
