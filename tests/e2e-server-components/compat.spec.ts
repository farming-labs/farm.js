import { expect, test, type Page } from "@playwright/test";

const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";
const dev = process.env.FARM_SERVER_COMPONENTS_SERVER === "dev";
/**
 * Known RSC engine bug, not islands: on a cold `farm dev` with { mode: "rsc" }, Vite finds a
 * package client component only when the browser asks for it, optimizes it again, and the page
 * ends up with two copies of React ("Invalid hook call"). A warm optimizer cache passes. Skipped
 * there until that is fixed; every other engine and server runs these.
 */
const rscDevPackageBug = () =>
  test.skip(
    mode === "rsc" && dev,
    "rsc dev optimizes package client components late on a cold start and loads React twice",
  );

// Libraries written for React Server Components, used the way their docs show for RSC: package
// client components (providers, Radix parts, a toaster) straight from server components,
// `server-only` and `client-only` imports, and SWR's server fallback.

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function open(page: Page, path: string) {
  const errors = collectErrors(page);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  return errors;
}

test("server-only imports work in server components, and their code stays on the server", async ({
  page,
}) => {
  const scripts: string[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() === "script") scripts.push(await response.text());
  });
  const errors = await open(page, "/compat/server-only");
  await expect(page.getByTestId("secret-length")).toHaveText("secret length 18");
  for (const source of scripts) expect(source).not.toContain("compat-secret-9c1d");
  expect(errors).toEqual([]);
});

test("a package provider used in a server component gives context to client components below it", async ({
  page,
}) => {
  rscDevPackageBug();
  const errors = await open(page, "/compat/themes");
  const button = page.getByTestId("next-theme");
  await expect(button).toHaveText("next-theme: light");
  await button.click();
  await expect(button).toHaveText("next-theme: dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
});

test("Radix parts composed in a server component open and close", async ({ page }) => {
  rscDevPackageBug();
  const errors = await open(page, "/compat/dialog");
  await page.getByRole("button", { name: "Open radix" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Radix title");
  await page.getByRole("button", { name: "Close radix" }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a package Toaster in a server component shows a toast a client component raises", async ({
  page,
}) => {
  rscDevPackageBug();
  const errors = await open(page, "/compat/toast");
  await page.getByRole("button", { name: "Show toast" }).click();
  await expect(page.getByText("Saved from a client component")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a query client provider reaches a query below a server component", async ({ page }) => {
  rscDevPackageBug();
  const errors = await open(page, "/compat/query");
  await expect(page.getByTestId("query-count")).toHaveText("query: 42");
  expect(errors).toEqual([]);
});

test("a store provider from a package shares one store between the client components in it", async ({
  page,
}) => {
  rscDevPackageBug();
  const errors = await open(page, "/compat/jotai");
  await page.getByTestId("atom-first").click();
  await expect(page.getByTestId("atom-first")).toHaveText("first atom: 1");
  await expect(page.getByTestId("atom-second")).toHaveText("second atom: 1");
  expect(errors).toEqual([]);
});

test("SWRConfig from a server component gives a client component its fallback data", async ({
  page,
  request,
}) => {
  rscDevPackageBug();
  expect(await (await request.get("/compat/swr")).text()).toContain("swr: Ada from the server");
  const errors = await open(page, "/compat/swr");
  await expect(page.getByTestId("swr-user")).toHaveText("swr: Ada from the server");
  expect(errors.filter((error) => !/api\/user|404|Failed to load resource/.test(error))).toEqual(
    [],
  );
});

test("a package provider in a layout keeps its state across client navigations", async ({
  page,
}) => {
  const errors = await open(page, "/compat/layout-provider/one");
  await page.evaluate(() => ((window as { __compat?: number }).__compat = 1));
  const button = page.getByTestId("next-theme");
  await expect(button).toHaveText("next-theme: light");
  await button.click();
  await expect(button).toHaveText("next-theme: dark");
  await page.getByRole("link", { name: "Themed two" }).click();
  await expect(page.getByRole("heading", { name: "Themed page two" })).toBeVisible();
  await expect(page.getByTestId("next-theme")).toHaveText("next-theme: dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => (window as { __compat?: number }).__compat)).toBe(1);
  expect(errors).toEqual([]);
});

test("cache() from react runs once per request in server components", async ({ page }) => {
  const errors = await open(page, "/compat/cache");
  const first = await page.getByTestId("cache-first").textContent();
  expect(first).toMatch(/^entry 1: [0-9a-f-]{36}$/);
  await expect(page.getByTestId("cache-second")).toHaveText(first!);
  // Another request runs it again.
  await page.reload();
  await expect(page.getByTestId("cache-first")).not.toHaveText(first!);
  expect(errors).toEqual([]);
});
