import { expect, test, type Page } from "./fixtures";

// A plugin's `client` hooks run in the browser entry, as in Farm's other entries. The contract
// app has a plugin that records them in rsc mode only (examples/server-components/farm.config.ts).
const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";
const dev = process.env.FARM_SERVER_COMPONENTS_SERVER === "dev";

test.skip(mode !== "rsc", "the islands build has no client plugin");

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

function events(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as { __FARM_CLIENT_PLUGIN_EVENTS__?: string[] }).__FARM_CLIENT_PLUGIN_EVENTS__ ?? [],
  );
}

const started = [
  `setup:contract:${dev ? "dev" : "prod"}`,
  "hydration:before:hydrate",
  "hydration:after",
];

/** The hooks one navigation runs, in order; `resolved` sees the committed page. */
function navigation(action: string, pathname: string, heading: string): string[] {
  return [
    `navigation:before:${action}:${pathname}`,
    `navigation:loaded:${pathname}`,
    `navigation:resolved:${pathname}:${heading}`,
    `navigation:rendered:${pathname}`,
  ];
}

test("client plugins set up before hydration and see each client navigation", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/nav/a");
  await expect.poll(() => events(page)).toEqual(started);
  await page.evaluate(() => Object.assign(window, { __contractDocument: true }));

  await page.getByRole("link", { name: "Page B" }).click();
  await expect(page.getByRole("heading", { name: "Nav page B" })).toBeVisible();
  await expect
    .poll(() => events(page))
    .toEqual([...started, ...navigation("push", "/nav/b", "Nav page B")]);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Nav page A" })).toBeVisible();
  await expect
    .poll(() => events(page))
    .toEqual([
      ...started,
      ...navigation("push", "/nav/b", "Nav page B"),
      ...navigation("pop", "/nav/a", "Nav page A"),
    ]);

  // Every move stayed a client navigation: the document is the one the page loaded with.
  expect(await page.evaluate(() => "__contractDocument" in window)).toBe(true);
  expect(errors).toEqual([]);
});

test("a plugin navigates with the router its hooks get", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/nav/a");
  await expect.poll(() => events(page)).toEqual(started);
  await page.evaluate(() => Object.assign(window, { __contractDocument: true }));

  await page.evaluate(() =>
    (
      window as { __FARM_CLIENT_PLUGIN_ROUTER__?: { navigate(href: string): Promise<void> } }
    ).__FARM_CLIENT_PLUGIN_ROUTER__!.navigate("/nav/b"),
  );
  await expect(page).toHaveURL(/\/nav\/b$/);
  await expect(page.getByRole("heading", { name: "Nav page B" })).toBeVisible();
  await expect
    .poll(() => events(page))
    .toEqual([...started, ...navigation("push", "/nav/b", "Nav page B")]);
  expect(await page.evaluate(() => "__contractDocument" in window)).toBe(true);
  expect(errors).toEqual([]);
});

test("a navigation that fails reaches the plugin's error hook before the page loads as a document", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/nav/a");
  await expect.poll(() => events(page)).toEqual(started);
  // Keep what the hooks recorded across the document load the failure falls back to.
  await page.evaluate(() => {
    addEventListener("pagehide", () =>
      sessionStorage.setItem(
        "contract-events",
        JSON.stringify(
          (window as { __FARM_CLIENT_PLUGIN_EVENTS__?: string[] }).__FARM_CLIENT_PLUGIN_EVENTS__,
        ),
      ),
    );
  });
  await page.route("**/nav/b.rsc", (route) => route.fulfill({ status: 500, body: "down" }));

  await page.getByRole("link", { name: "Page B" }).click();
  await expect(page.getByRole("heading", { name: "Nav page B" })).toBeVisible();
  const recorded = await page.evaluate(() => sessionStorage.getItem("contract-events"));
  expect(JSON.parse(recorded ?? "[]")).toEqual([
    ...started,
    "navigation:before:push:/nav/b",
    "navigation:error:/nav/b",
  ]);
  // The new document starts the plugins again.
  await expect.poll(() => events(page)).toEqual(started);
  // The failed payload request is the one error the page reports.
  expect(errors.filter((error) => !error.includes("500"))).toEqual([]);
});
