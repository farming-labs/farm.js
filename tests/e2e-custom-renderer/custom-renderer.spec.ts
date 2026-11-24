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

test("the router reads the request's path while the server renders a page", async ({ request }) => {
  const response = await request.get("/crops/wheat");
  expect(response.status()).toBe(200);
  // Not the site root: the server rendered the path the browser shows.
  expect(await response.text()).toContain('<p id="crop-path">path: /crops/wheat</p>');
});

test("a page whose hydration throws is rendered in the browser instead", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // The page's first browser render throws, so hydrateRoot() fails. Development and production
  // both render the route with createRoot() then, so the layout's effect runs and the page works.
  await gotoHydrated(page, "/recovers");
  expect(
    errors.some((text) =>
      text.includes("[Farm.js] Hydration error; rendering the page on the client instead:"),
    ),
  ).toBe(true);
  const counter = page.locator("#recovers-counter");
  await counter.click();
  await expect(counter).toHaveText("Clicked 1 times");
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

test("a browser module calls a server function, which runs on the server", async ({ page }) => {
  const scripts: Array<Promise<string>> = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") {
      scripts.push(response.text().catch(() => ""));
    }
  });
  await gotoHydrated(page, "/");
  // useServerQuery reads after hydration. Other tests may have planted already, so compare counts.
  const total = page.locator("#planted-total");
  await expect(total).toHaveText(/^Planted so far: \d+$/);
  const before = Number((await total.textContent())?.match(/\d+/)?.[0]);
  const call = page.waitForRequest(
    (request) => request.method() === "POST" && request.headers()["f-action"] !== undefined,
  );
  await page.locator("#plant").click();
  // The call posts to the page, which runs the action.
  expect(new URL((await call).url()).pathname).toBe("/");
  await expect(page.locator("#planted")).toHaveText("Planted barley on the server.");
  // The action invalidated the query's key, so the query read again.
  await expect(total).toHaveText(`Planted so far: ${before + 1}`);
  // The browser got a reference, not the handler, whose message is a template literal.
  for (const source of await Promise.all(scripts)) expect(source).not.toContain("Planted ${");
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

test("a page streams what's before a Suspense boundary before the async component in it", async ({
  baseURL,
}) => {
  const response = await fetch(`${baseURL}/streaming`);
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (!html.includes("This arrives first.")) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  // The list waits on its data, so the chunks that carried the text before it can't hold it.
  expect(html).toContain("This arrives first.");
  expect(html).not.toContain('id="slow-crops"');
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  expect(html).toContain('<ul id="slow-crops"><li>wheat</li><li>barley</li><li>rye</li></ul>');
  expect(html).toMatch(/<\/html>\s*$/);
});

test("a client navigation renders a page with an async component", async ({ page }) => {
  await gotoHydrated(page, "/");
  await markDocument(page);
  await page.getByRole("link", { name: "Streaming" }).click();
  await expect(page).toHaveURL(/\/streaming$/);
  await expect(page.locator("#slow-crops li")).toHaveText(["wheat", "barley", "rye"]);
  await expect(page).toHaveTitle("Streaming");
  expect(await readDocumentMark(page)).toBe("first");
});

test("API routes answer next to leaf pages", async ({ request }) => {
  const response = await request.get("/api/crops");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ crops: ["wheat", "barley", "rye"], renderer: "leaf" });
});

test("client components in a server page hydrate as islands, each when its strategy says", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const response = await page.goto("/islands");
  const html = await response!.text();
  // The module's `island` export is the default; client:* overrides it where a Counter is used.
  expect(html).toContain('export="Counter" props="fi0" strategy="load"');
  expect(html).toContain('export="Counter" props="fi1" strategy="idle"');
  expect(html).toContain('export="Counter" props="fi2" strategy="visible"');
  expect(html).not.toContain("client:");

  await expect(page.locator(".shell")).toHaveAttribute("data-hydrated", "true");
  const load = page.locator("#island-load");
  const idle = page.locator("#island-idle");
  const visible = page.locator("#island-visible");
  await expect(load).toHaveAttribute("data-hydrated", "true");
  await expect(idle).toHaveAttribute("data-hydrated", "true");
  // Props crossed through Farm's codec: the Date and the Map arrive as themselves.
  await expect(load.locator(".props")).toHaveText("2026-03-01, 2 crops");
  // Below the fold, the third waits for the page to scroll to it.
  await expect(visible.locator(".props")).toHaveText("server");
  await expect(visible).not.toHaveAttribute("data-hydrated", "true");

  // Each island is its own root, apart from the layout's.
  await load.getByRole("button").click();
  await load.getByRole("button").click();
  await expect(load.getByRole("button")).toHaveText("Starts at once: 2");
  await expect(idle.getByRole("button")).toHaveText("Starts when the browser is idle: 0");
  await page.locator("#layout-counter").click();
  await expect(page.locator("#layout-counter")).toHaveText("Layout clicks: 1");
  await expect(load.getByRole("button")).toHaveText("Starts at once: 2");

  await visible.scrollIntoViewIfNeeded();
  await expect(visible).toHaveAttribute("data-hydrated", "true");
  await visible.getByRole("button").click();
  await expect(visible.getByRole("button")).toHaveText("Starts when scrolled to: 1");
  expect(errors).toEqual([]);
});

test("a client navigation starts a server page's islands, and leaving it ends them", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await gotoHydrated(page, "/about");
  await markDocument(page);
  const layoutCounter = page.locator("#layout-counter");
  await layoutCounter.click();

  await page.getByRole("link", { name: "Islands" }).click();
  await expect(page).toHaveURL(/\/islands$/);
  const load = page.locator("#island-load");
  await expect(load).toHaveAttribute("data-hydrated", "true");
  await load.getByRole("button").click();
  await expect(load.getByRole("button")).toHaveText("Starts at once: 1");
  await expect(layoutCounter).toHaveText("Layout clicks: 1");

  await page.getByRole("link", { name: "About" }).click();
  await expect(page.locator("#about")).toBeVisible();
  await expect(load).toHaveCount(0);

  // Back on the page, its islands start again from the server's HTML.
  await page.getByRole("link", { name: "Islands" }).click();
  await expect(load).toHaveAttribute("data-hydrated", "true");
  await expect(load.getByRole("button")).toHaveText("Starts at once: 0");
  await load.getByRole("button").click();
  await expect(load.getByRole("button")).toHaveText("Starts at once: 1");
  await expect(layoutCounter).toHaveText("Layout clicks: 1");
  expect(await readDocumentMark(page)).toBe("first");
  expect(errors).toEqual([]);
});

// src/app/guides uses flat files instead of folders: farm-leaf's `routes()` maps them, and its
// `hydration` reads leaf's own `// @hydrate` pragma.

/** Whether the server marked the page to hydrate, read from the HTML it sent. */
async function readPageHydration(path: string, baseURL: string | undefined) {
  const response = await fetch(`${baseURL}${path}`);
  expect(response.status).toBe(200);
  const html = await response.text();
  return html.match(/id="__farm_page__"[^>]*data-farm-client="(true|false)"/)?.[1];
}

test("flat .leaf files are pages inside the folder's _layout.leaf", async ({ page }) => {
  const response = await gotoHydrated(page, "/guides");
  expect(response?.status()).toBe(200);
  await expect(page.locator("#guides-layout #guides")).toHaveText("Guides");
  // _tip.leaf is a component the page imports, not a route.
  await expect(page.locator("#guides-tip")).toHaveText(
    "Files that start with an underscore aren't pages.",
  );
  // The root layout still wraps the folder's layout.
  await expect(page.locator(".shell #guides-layout")).toBeVisible();

  const crop = await gotoHydrated(page, "/guides/wheat");
  expect(crop?.status()).toBe(200);
  await expect(page.locator("#guides-layout #guide-crop")).toHaveText("Growing wheat");
  await expect(page).toHaveTitle("Growing wheat");
});

test("files the route rules skip answer 404", async ({ request }) => {
  for (const path of [
    "/guides/_tip",
    "/guides/_layout",
    "/guides/watering.client",
    "/guides/corn",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }
});

test("a rule's hydrate flag and leaf's pragma hydrate their pages; the rest stay server-only", async ({
  page,
  baseURL,
}) => {
  expect(await readPageHydration("/guides", baseURL)).toBe("false");
  expect(await readPageHydration("/guides/wheat", baseURL)).toBe("false");
  // watering.client.leaf: the `.client` rule. harvest.leaf: `// @hydrate interaction`.
  expect(await readPageHydration("/guides/watering", baseURL)).toBe("true");
  expect(await readPageHydration("/guides/harvest", baseURL)).toBe("true");

  await gotoHydrated(page, "/guides/watering");
  const watering = page.locator("#watering-counter");
  await watering.click();
  await expect(watering).toHaveText("Checked 1 times");

  await gotoHydrated(page, "/guides/harvest");
  const harvest = page.locator("#harvest-counter");
  await harvest.click();
  await expect(harvest).toHaveText("Baskets: 1");
});

test("the guides layout's Links navigate between flat pages on the client", async ({ page }) => {
  await gotoHydrated(page, "/guides");
  await markDocument(page);
  const layoutCounter = page.locator("#layout-counter");
  await layoutCounter.click();
  await expect(layoutCounter).toHaveText("Layout clicks: 1");

  const guides = page.getByRole("navigation", { name: "Guides" });
  await guides.getByRole("link", { name: "Wheat" }).click();
  await expect(page).toHaveURL(/\/guides\/wheat$/);
  await expect(page.locator("#guide-crop")).toHaveText("Growing wheat");
  await expect(page).toHaveTitle("Growing wheat");

  await guides.getByRole("link", { name: "Watering" }).click();
  await expect(page).toHaveURL(/\/guides\/watering$/);
  const watering = page.locator("#watering-counter");
  await watering.click();
  await expect(watering).toHaveText("Checked 1 times");

  await guides.getByRole("link", { name: "All guides" }).click();
  await expect(page.locator("#guides")).toHaveText("Guides");
  await expect(layoutCounter).toHaveText("Layout clicks: 1");
  expect(await readDocumentMark(page)).toBe("first");
});
