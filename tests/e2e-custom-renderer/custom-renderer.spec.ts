import { expect, test, type Page } from "@playwright/test";

// examples/custom-renderer runs on leaf, a UI library Farm has no code for, through the farm-leaf
// adapter. The same checks run against `farm dev` and the production build.

/** The layout sets data-hydrated from an effect, which runs once leaf has hydrated the root. */
async function gotoHydrated(page: Page, path: string) {
  const response = await page.goto(path);
  await expect(page.locator(".shell")).toHaveAttribute("data-hydrated", "true");
  return response;
}

/** A value on window survives client navigation and is gone after a document load. */
async function markDocument(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __leafDocument?: string }).__leafDocument = "first";
  });
}

async function readDocumentMark(page: Page) {
  return page.evaluate(() => (window as unknown as { __leafDocument?: string }).__leafDocument);
}

test("server renders a leaf page and hydrates the markup it sent", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Keep the button the server sent, from before any script runs.
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      const button = document.querySelector("#counter");
      if (!button) return;
      (window as unknown as { __serverCounter?: Element }).__serverCounter = button;
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const html = await response!.text();
  expect(html).toContain("<title>leaf on Farm</title>");
  expect(html).toContain('<button type="button" id="counter">Clicked 0 times</button>');

  await expect(page.locator(".shell")).toHaveAttribute("data-hydrated", "true");
  // Hydration adopted the server's button instead of replacing it.
  expect(
    await page.evaluate(
      () =>
        document.querySelector("#counter") ===
        (window as unknown as { __serverCounter?: Element }).__serverCounter,
    ),
  ).toBe(true);
  await expect(page.locator("#path")).toHaveText("path: /");

  const counter = page.locator("#counter");
  await counter.click();
  await expect(counter).toHaveText("Clicked 1 times");
  await counter.click();
  await expect(counter).toHaveText("Clicked 2 times");
  expect(errors).toEqual([]);
});

test("a Link navigates on the client and the layout keeps its state", async ({ page }) => {
  await gotoHydrated(page, "/");
  await markDocument(page);
  const layoutCounter = page.locator("#layout-counter");
  await layoutCounter.click();
  await expect(layoutCounter).toHaveText("Layout clicks: 1");

  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.locator("#about")).toContainText("leaf is a small UI library");
  await expect(page).toHaveTitle("About leaf");
  await expect(layoutCounter).toHaveText("Layout clicks: 1");

  await page.getByRole("link", { name: "Wheat" }).click();
  await expect(page).toHaveURL(/\/crops\/wheat$/);
  await expect(page.locator("#crop")).toHaveText("Crop: wheat");
  await expect(page).toHaveTitle("Crop: wheat");

  await page.goBack();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.locator("#about")).toBeVisible();
  await expect(layoutCounter).toHaveText("Layout clicks: 1");
  expect(await readDocumentMark(page)).toBe("first");
});

test("router.push from a leaf hook navigates without a document load", async ({ page }) => {
  await gotoHydrated(page, "/");
  await markDocument(page);
  await page.locator("#go-about").click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.locator("#about")).toBeVisible();
  expect(await readDocumentMark(page)).toBe("first");
});

test("a page navigated to on the client is interactive", async ({ page }) => {
  await gotoHydrated(page, "/about");
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.locator("#path")).toHaveText("path: /");
  const counter = page.locator("#counter");
  await counter.click();
  await expect(counter).toHaveText("Clicked 1 times");
});

test("a .leaf page compiles, renders its .leaf component, and hydrates", async ({ page }) => {
  const response = await gotoHydrated(page, "/notes");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Notes in a .leaf file");
  await expect(page.locator("#badge")).toHaveText("compiled by farm-leaf/vite");
  const notes = page.locator("#notes-counter");
  await notes.click();
  await expect(notes).toHaveText("Notes: 1");
});

test("a button calls a server function through an API route", async ({ page }) => {
  await gotoHydrated(page, "/");
  await page.locator("#plant").click();
  await expect(page.locator("#planted")).toHaveText("Planted barley on the server.");
});

test("notFound() and a throwing page answer with their route files and statuses", async ({
  page,
}) => {
  const missing = await page.goto("/crops/corn");
  expect(missing?.status()).toBe(404);
  await expect(page.locator("#not-found")).toHaveText("No crop grows here.");

  const unknown = await page.goto("/no-such-page");
  expect(unknown?.status()).toBe(404);
  await expect(page.locator("#not-found")).toBeVisible();

  const broken = await page.goto("/broken");
  expect(broken?.status()).toBe(500);
  await expect(page.locator("#error")).toHaveText("Something broke while rendering this page.");
});

test("API routes answer next to leaf pages", async ({ request }) => {
  const response = await request.get("/api/crops");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ crops: ["wheat", "barley", "rye"], renderer: "leaf" });
});
