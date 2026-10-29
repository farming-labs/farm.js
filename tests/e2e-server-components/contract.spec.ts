import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The server components contract. Every test runs against the same app built with
// { mode: "rsc" } and with { mode: "islands" } (playwright.server-components.config.ts).
const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";
const dev = process.env.FARM_SERVER_COMPONENTS_SERVER === "dev";
const output = path.resolve("examples/server-components", `.farm/.output-${mode}`);

/** Console errors and uncaught exceptions while the page runs. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

/** Waits until React has attached handlers: a click on `locator` changes the page. */
async function hydrated(page: Page) {
  await page.waitForLoadState("networkidle");
}

test("server components render on the server and their code stays there", async ({
  page,
  request,
}) => {
  const html = await (await request.get("/")).text();
  expect(html).toContain("Server value length: 27");
  expect(html).toContain("Count: 5");

  const scripts: string[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() === "script") scripts.push(await response.text());
  });
  const errors = collectErrors(page);
  await page.goto("/");
  await hydrated(page);
  expect(scripts.length).toBeGreaterThan(0);
  for (const source of scripts) expect(source).not.toContain("contract-server-only-7f3a9c");
  expect(errors).toEqual([]);
});

test("a client component hydrates with the props the server gave it", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await hydrated(page);
  await page.getByRole("button", { name: "Count: 5" }).click();
  await expect(page.getByRole("button", { name: "Count: 6" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("server output passed as children stays server output inside a client component", async ({
  page,
  request,
}) => {
  const html = await (await request.get("/children")).text();
  expect(html).toContain("Server item gamma");
  const errors = collectErrors(page);
  await page.goto("/children");
  await hydrated(page);
  const body = page.getByTestId("collapsible-body");
  await expect(body).toContainText("Server item alpha");
  await page.getByRole("button", { name: "Toggle list" }).click();
  await expect(body).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle list" }).click();
  await expect(page.getByTestId("collapsible-body")).toContainText("Server item beta");
  expect(errors).toEqual([]);
});

test("a client component reads context from a client provider in a server layout", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/context");
  await hydrated(page);
  await expect(page.getByTestId("theme-label")).toHaveText("Theme: light");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.getByTestId("theme-label")).toHaveText("Theme: dark");
  expect(errors).toEqual([]);
});

test("async server components resolve before the HTML is sent", async ({ request }) => {
  const html = await (await request.get("/async")).text();
  expect(html).toContain("Loaded first");
  expect(html).toContain("Loaded second");
});

test("a Suspense boundary streams its fallback first, then the content", async ({
  baseURL,
  page,
}) => {
  const response = await fetch(`${baseURL}/stream`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let received = "";
  let fallbackFirst = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
    if (
      !fallbackFirst &&
      received.includes("Loading slow content") &&
      !received.includes("Slow content arrived")
    ) {
      fallbackFirst = true;
    }
  }
  expect(fallbackFirst).toBe(true);
  expect(received).toContain("Slow content arrived");

  await page.goto("/stream");
  await expect(page.getByTestId("slow-content")).toBeVisible();
});

test("generateMetadata sets the head", async ({ request }) => {
  const html = await (await request.get("/meta")).text();
  expect(html).toContain("<title>Contract meta 42</title>");
  expect(html).toMatch(/<meta name="description" content="Metadata from generateMetadata"/);
});

test("static pages are prerendered at build time", async ({ request }) => {
  test.skip(dev, "build output only");
  expect(existsSync(path.join(output, "public/static/a/index.html"))).toBe(true);
  expect(await (await request.get("/static/b")).text()).toContain("Static b");
});

test("a server action runs from a form, with JavaScript", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/action");
  await hydrated(page);
  await page.getByLabel("Title").fill("From the browser");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("todos")).toContainText("From the browser");
  expect(errors).toEqual([]);
});

test("a server action runs from a form before JavaScript loads", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/action");
  await page.getByLabel("Title").fill("Without JavaScript");
  await page.getByRole("button", { name: "Add" }).click();
  await page.waitForLoadState("load");
  await page.goto("/action");
  await expect(page.getByTestId("todos")).toContainText("Without JavaScript");
  await context.close();
});

test("client navigation keeps a layout's client state and does not reload the document", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/nav/a");
  await hydrated(page);
  await page.evaluate(() => ((window as { __contract?: number }).__contract = 1));
  await page.getByRole("button", { name: "Layout clicks: 0" }).click();
  await page.getByRole("link", { name: "Page B" }).click();
  await expect(page.getByRole("heading", { name: "Nav page B" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Layout clicks: 1" })).toBeVisible();
  expect(await page.evaluate(() => (window as { __contract?: number }).__contract)).toBe(1);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Nav page A" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("browser-only code runs after hydration without a mismatch", async ({ page, request }) => {
  expect(await (await request.get("/window")).text()).toContain("Measuring");
  const errors = collectErrors(page);
  await page.goto("/window");
  await expect(page.getByTestId("window-width")).toHaveText(/^Width \d+$/);
  expect(errors).toEqual([]);
});

test("a large value shared by two client components survives client navigation", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const documents: string[] = [];
  page.on("response", async (response) => {
    const type = response.request().resourceType();
    if (type === "document" || type === "fetch") documents.push(await response.text());
  });
  await page.goto("/values/a");
  await hydrated(page);
  await page.evaluate(() => ((window as { __contract?: number }).__contract = 1));
  await page.getByRole("button", { name: "Select in Sidebar" }).click();
  await expect(page.getByText("Sidebar: 120 items, 1 selected")).toBeVisible();
  await page.getByRole("link", { name: "Values B" }).click();
  await expect(page.getByRole("heading", { name: "Values page B" })).toBeVisible();
  expect(await page.evaluate(() => (window as { __contract?: number }).__contract)).toBe(1);
  await page.getByRole("button", { name: "Select in Menu" }).click();
  await expect(page.getByText("Menu: 120 items, 1 selected")).toBeVisible();
  expect(errors).toEqual([]);

  if (mode === "islands") {
    // The list travels once, keyed by content. A navigation never sends it again: the server
    // leaves out the layout the browser keeps, and values the browser holds.
    const [first, ...navigations] = documents;
    expect(first).toMatch(/<script type="f\/value" name="[0-9a-z]{14}">/);
    expect(navigations.length).toBeGreaterThan(0);
    for (const body of navigations) {
      // Nor the layout the browser keeps: only the page segment travels.
      expect(body).not.toContain("Select in Sidebar");
      expect(body).not.toContain('type="f/value"');
      expect(body).not.toContain("Catalog entry 7 with");
    }
  }
});

test("a client component calls a server action it received as a prop, and the page shows the result", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/action-props");
  await hydrated(page);
  await page.evaluate(() => ((window as { __contract?: number }).__contract = 1));
  await page.getByRole("button", { name: "Island clicks: 0" }).click();
  const title = `prop item ${Date.now()}`;
  await page.getByLabel("Item").fill(title);
  await page.getByRole("button", { name: "Add item" }).click();
  // The page refreshes after the action, without a document load, and keeps client state.
  await expect(page.getByTestId("items")).toContainText(title);
  await expect(page.getByRole("button", { name: "Island clicks: 1" })).toBeVisible();
  expect(await page.evaluate(() => (window as { __contract?: number }).__contract)).toBe(1);
  expect(errors).toEqual([]);
});

test("a server action passed as a prop works before JavaScript loads", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/action-props");
  const title = `no-js prop item ${Date.now()}`;
  await page.getByLabel("Item").fill(title);
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByTestId("items")).toContainText(title);
  await context.close();
});

test("a client component receives values JSON cannot hold as their own types", async ({
  page,
  request,
}) => {
  const expected =
    "2026-10-28T09:00:00.000Z | new,sale | sku-1=3 | 12345678901234567890n | undefined | NaN | Infinity | -0 | 0.1.254.255";
  expect(await (await request.get("/types")).text()).toContain("12345678901234567890n");
  const errors = collectErrors(page);
  await page.goto("/types");
  await hydrated(page);
  await expect(page.getByTestId("typed")).toHaveText(expected);
  // It hydrated with those props: it responds, and still shows the same values.
  await page.getByRole("button", { name: "Typed clicks: 0" }).click();
  await expect(page.getByRole("button", { name: "Typed clicks: 1" })).toBeVisible();
  await expect(page.getByTestId("typed")).toHaveText(expected);
  expect(errors).toEqual([]);
});
