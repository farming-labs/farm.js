import { expect, test, type Page } from "./fixtures";

// Behaviors Next.js's App Router tests check (vercel/next.js, test/e2e/app-dir), ported to Farm's
// API. Like the contract, they run against { mode: "rsc" } and { mode: "islands" }, in `farm dev`
// and in production builds (playwright.server-components.config.ts). The pages are under /next.
/** Uncaught exceptions and console errors while the page runs. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function hydrated(page: Page) {
  await page.waitForLoadState("networkidle");
}

const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";

/** { mode: "rsc" } answers 404 without the app's not-found page; these fail there until it renders it. */
function expectNoNotFoundPageInRsc() {
  test.fail(mode === "rsc", "rsc mode does not render not-found.tsx yet");
}

const ESCAPE_TEXT =
  '</script><script>window.__farmEscaped = 1</script><!--    "quote" & <b>bold</b> -->';

// rsc-basic: "should correctly render page/component returning null/undefined".
test("components that render null or undefined, and a page that renders nothing", async ({
  page,
  request,
}) => {
  const errors = collectErrors(page);
  await page.goto("/next/nothing");
  await hydrated(page);
  await expect(page.getByTestId("after-nothing")).toHaveText("Still renders");
  expect((await request.get("/next/empty")).status()).toBe(200);
  expect(errors).toEqual([]);
});

// rsc-basic: "should handle client components imported as namespace".
test("a client component used through a namespace import hydrates", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/next/namespace");
  await hydrated(page);
  const badge = page.getByTestId("namespace-badge");
  await expect(badge).toHaveText("namespaced 0");
  await badge.click();
  await expect(badge).toHaveText("namespaced 1");
  expect(errors).toEqual([]);
});

// rsc-basic: "should escape streaming data correctly".
test("text that looks like markup stays text in HTML, props and streamed content", async ({
  page,
  request,
}) => {
  const errors = collectErrors(page);
  // The text may appear inside a script once escaped (RSC writes `</\script>`), never as markup.
  expect(await (await request.get("/next/escape")).text()).not.toContain(
    "</script><script>window.__farmEscaped",
  );
  await page.goto("/next/escape");
  await expect(page.getByTestId("streamed-text")).toBeVisible();
  await hydrated(page);
  expect(await page.evaluate(() => "__farmEscaped" in window)).toBe(false);
  expect(await page.getByTestId("server-text").textContent()).toBe(ESCAPE_TEXT);
  expect(await page.getByTestId("streamed-text").textContent()).toBe(ESCAPE_TEXT);
  await page.getByTestId("echo-show").click();
  await expect(page.getByTestId("echo-text")).toBeVisible();
  expect(await page.getByTestId("echo-text").textContent()).toBe(ESCAPE_TEXT);
  expect(errors).toEqual([]);
});

// rsc-basic: "should handle dynamic routes when URL segment matches the folder bracket syntax".
test("a URL segment spelled like the folder's brackets is that param's value", async ({
  request,
}) => {
  const response = await request.get("/next/segment/%5Bid%5D");
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("Segment [id]");
});

// css: "should support global css inside server components" and "should support css modules
// inside server components".
test("stylesheets a server page and its server components import style the page", async ({
  page,
}) => {
  await page.goto("/next/styled");
  await expect(page.getByTestId("styled-text")).toHaveCSS("color", "rgb(10, 20, 30)");
  await expect(page.getByTestId("styled-badge")).toHaveCSS("color", "rgb(40, 50, 60)");
});

// navigation: "should trigger not-found in a server component"; not-found/basic.
test("notFound() in a page answers 404 with the app's not-found page", async ({ page }) => {
  expectNoNotFoundPageInRsc();
  const response = await page.goto("/next/not-found-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("not-found")).toHaveText("This page does not exist.");
});

// not-found/basic: a URL no route matches.
test("a URL that matches no route answers 404 with the app's not-found page", async ({ page }) => {
  expectNoNotFoundPageInRsc();
  const response = await page.goto("/next/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("not-found")).toHaveText("This page does not exist.");
});

// navigation: "should trigger not-found client-side"; error-boundary-navigation: "should allow
// navigating back from notFound".
test("a client navigation to a page that calls notFound() shows the not-found page", async ({
  page,
}) => {
  expectNoNotFoundPageInRsc();
  await page.goto("/next");
  await hydrated(page);
  await page.getByRole("link", { name: "To not found" }).click();
  await expect(page.getByTestId("not-found")).toHaveText("This page does not exist.");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Next behaviors" })).toBeVisible();
});

// navigation: "should trigger not-found while streaming"; SEO: "should emit noindex meta tag for
// not found page when streaming".
test("notFound() after the shell has streamed shows the not-found page, marked noindex", async ({
  page,
}) => {
  expectNoNotFoundPageInRsc();
  await page.goto("/next/not-found-stream");
  await expect(page.getByTestId("not-found")).toHaveText("This page does not exist.");
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
});

// navigation: "should redirect in a server component".
test("redirect() in a page answers 307 with its location", async ({ request }) => {
  const response = await request.get("/next/redirect", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toMatch(/\/next\/target$/);
});

// navigation: "should redirect client-side".
test("a client navigation to a page that redirects lands on its target", async ({ page }) => {
  await page.goto("/next");
  await hydrated(page);
  await page.getByRole("link", { name: "To redirect" }).click();
  await expect(page).toHaveURL(/\/next\/target$/);
  await expect(page.getByRole("heading", { name: "Redirect target" })).toBeVisible();
});

// error-boundary-navigation: the error boundary renders, and "should allow navigation to other
// routes after error".
test("an error in a server component renders the nearest error.tsx, and a link leaves it", async ({
  page,
}) => {
  const response = await page.goto("/next/broken");
  expect(response?.status()).toBe(500);
  await expect(page.getByTestId("error-boundary")).toBeVisible();
  await hydrated(page);
  await page.getByRole("link", { name: "Leave the broken page" }).click();
  await expect(page.getByRole("heading", { name: "Redirect target" })).toBeVisible();
});

// error-boundary-navigation: an error reached by a client navigation.
test("a client navigation to a page that throws shows its error.tsx", async ({ page }) => {
  await page.goto("/next");
  await hydrated(page);
  await page.getByRole("link", { name: "To broken" }).click();
  await expect(page.getByTestId("error-boundary")).toBeVisible();
});

// navigation: "should handle unicode search params".
test("unicode search params reach the page, on a load and on a client navigation", async ({
  page,
}) => {
  await page.goto("/next/query?name=%E4%BD%A0%E5%A5%BD");
  await expect(page.getByTestId("query-name")).toHaveText("你好");
  await page.goto("/next");
  await hydrated(page);
  await page.getByRole("link", { name: "To unicode query" }).click();
  await expect(page.getByTestId("query-name")).toHaveText("你好");
});

// navigation: "should scroll to the specified hash".
test("a link to a hash on the page scrolls to its element", async ({ page }) => {
  await page.goto("/next/hash");
  await hydrated(page);
  await page.getByRole("link", { name: "To the bottom" }).click();
  await expect(page).toHaveURL(/#bottom$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
});

// actions: a server action that calls redirect(), and useFormStatus while it runs.
test("a server action redirects, and the form shows it is pending meanwhile", async ({ page }) => {
  // The pending state lasts as long as the action, so the page records it rather than the test
  // polling for it.
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { __pendingSeen: seen });
    new MutationObserver((records) => {
      for (const record of records) {
        seen.push((record.target as Element).getAttribute("data-pending") ?? "");
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-pending"] });
  });
  await page.goto("/next/action-redirect");
  await hydrated(page);
  await page.getByTestId("pending").click();
  await expect(page).toHaveURL(/\/next\/target$/);
  await expect(page.getByRole("heading", { name: "Redirect target" })).toBeVisible();
  expect(
    await page.evaluate(() => (window as { __pendingSeen?: string[] }).__pendingSeen),
  ).toContain("true");
});

// app-action-progressive-enhancement: "should support formData and redirect without JS".
test("a server action redirects before JavaScript loads", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/next/action-redirect");
  await page.getByTestId("pending").click();
  await expect(page).toHaveURL(/\/next\/target$/);
  await expect(page.getByRole("heading", { name: "Redirect target" })).toBeVisible();
  await context.close();
});
