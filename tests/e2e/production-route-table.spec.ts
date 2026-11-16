import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// The production client loads its route table as its own chunk on the first navigation or
// prefetch: in the client entry, every page booted with about 147 bytes a route. A document names
// the table entries its own page boots with (window.__FARM_CLIENT_ROUTES__), and a navigation to
// any other route still runs in the same document.

test.skip(process.env.FARM_E2E_MODE !== "prod", "Production client route table");

type ClientRoute = { pattern: string };
type BootRoutes = { path: string; routes: ClientRoute[] };

async function readClientEntry(request: APIRequestContext, pathname: string) {
  const html = await (await request.get(pathname)).text();
  const boot = html.match(/window\.__FARM_CLIENT_ROUTES__=(.*?);(?:window\.|if\(|<\/script>)/);
  const entrySrc = html.match(/<script type="module"[^>]* src="([^"]+)"/)?.[1];
  expect(entrySrc).toBeDefined();
  const entry = await (await request.get(entrySrc!)).text();
  const tableFile = entry.match(/chunks\/farm-client-routes-h[0-9a-f]+\.js/)?.[0];
  expect(tableFile).toBeDefined();
  return {
    boot: boot ? (JSON.parse(boot[1]!) as BootRoutes) : null,
    entry,
    tableFile: `/${tableFile}`,
  };
}

function readTable(page: Page, tableFile: string): Promise<ClientRoute[]> {
  return page.evaluate(async (url) => (await import(url)).default, tableFile);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("the client entry leaves the route table to a chunk", async ({ page, request }) => {
  const home = await readClientEntry(request, "/");
  // The home page hydrates no route of its own: the document says so, so the client needs no
  // table to boot.
  expect(home.boot).toEqual({ path: "/", routes: [] });
  const user = await readClientEntry(request, "/users/7");
  expect(user.boot).toEqual({
    path: "/users/7",
    routes: [expect.objectContaining({ pattern: "/users/[id]", pageShouldHydrate: true })],
  });

  await page.goto("/");
  const table = await readTable(page, home.tableFile);
  expect(table.length).toBeGreaterThan(10);
  expect(table.map((route) => route.pattern)).toContain("/users/[id]");
  // No route's table entry is in the client entry every page loads (its layouts and links still
  // name their patterns).
  const quote = "[`\"']";
  for (const route of table) {
    expect(home.entry, route.pattern).not.toMatch(
      new RegExp(
        `pattern:\\s*${quote}${escapeRegExp(route.pattern)}${quote},\\s*` +
          `(?:directory:\\s*${quote}[^\`"']*${quote},\\s*)?pageShouldHydrate:`,
      ),
    );
  }
});

test("a page hydrates from the entries its document names, without the table", async ({ page }) => {
  await page.route(/\/chunks\/farm-client-routes-h[0-9a-f]+\.js$/, (route) => route.abort());
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/users/42?tab=hydrated");
  // The page's effect reads the query only once React has hydrated it.
  await expect(page.locator("li", { hasText: "searchParams.tab" })).toContainText('"hydrated"');
  expect(errors).toEqual([]);
});

test("production navigation reaches routes the document did not name", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/about");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  expect(await page.evaluate(() => (window as any).__FARM_CLIENT_ROUTES__)).toEqual({
    path: "/about",
    routes: [],
  });
  await page.evaluate(() => ((window as any).__sameDocument = true));

  // A dynamic route whose page hydrates, which the document did not name.
  await page.evaluate(() => (window as any).__FARM_SPA_ROUTER__.navigate("/users/42?tab=client"));
  await expect(page).toHaveURL(/\/users\/42\?tab=client$/);
  await expect(page.getByRole("heading", { level: 1, name: "User Profile: 42" })).toBeVisible();
  await expect(page.locator("li", { hasText: "searchParams.tab" })).toContainText('"client"');

  await page.locator('nav a[href="/about"]').click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { level: 1, name: /About/ })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/users\/42\?tab=client$/);
  await expect(page.getByRole("heading", { level: 1, name: "User Profile: 42" })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { level: 1, name: /About/ })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);

  // An unknown route still renders the not-found page.
  await page.evaluate(() => (window as any).__FARM_SPA_ROUTER__.navigate("/no-such-route-e2e"));
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a navigation without the route table loads the next page as a document", async ({ page }) => {
  // As a stale page sees a deployment that no longer serves its table.
  await page.route(/\/chunks\/farm-client-routes-h[0-9a-f]+\.js$/, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  await page.evaluate(() => ((window as any).__sameDocument = true));

  await page.evaluate(() => (window as any).__FARM_SPA_ROUTER__.navigate("/users/42"));
  await expect(page).toHaveURL(/\/users\/42$/);
  await expect(page.getByRole("heading", { level: 1, name: "User Profile: 42" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__sameDocument)).toBeUndefined();
});
