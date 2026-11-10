import { expect, test, type Page } from "./fixtures";

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
  const errors = await open(page, "/compat/themes");
  const button = page.getByTestId("next-theme");
  await expect(button).toHaveText("next-theme: light");
  await button.click();
  await expect(button).toHaveText("next-theme: dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
});

test("Radix parts composed in a server component open and close", async ({ page }) => {
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
  const errors = await open(page, "/compat/toast");
  await page.getByRole("button", { name: "Show toast" }).click();
  await expect(page.getByText("Saved from a client component")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a query client provider reaches a query below a server component", async ({ page }) => {
  const errors = await open(page, "/compat/query");
  await expect(page.getByTestId("query-count")).toHaveText("query: 42");
  expect(errors).toEqual([]);
});

test("a store provider from a package shares one store between the client components in it", async ({
  page,
}) => {
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

test("cache() from react runs once per request in server components, and cacheSignal() is live", async ({
  page,
}) => {
  const errors = await open(page, "/compat/cache");
  const first = await page.getByTestId("cache-first").textContent();
  expect(first).toMatch(/^entry 1: [0-9a-f-]{36}$/);
  await expect(page.getByTestId("cache-second")).toHaveText(first!);
  // React.cache through a namespace import memoizes the same way.
  const member = await page.getByTestId("cache-member-first").textContent();
  await expect(page.getByTestId("cache-member-second")).toHaveText(member!);
  await expect(page.getByTestId("cache-signal")).toHaveText("signal live");
  // Another request runs it again.
  await page.reload();
  await expect(page.getByTestId("cache-first")).not.toHaveText(first!);
  expect(errors).toEqual([]);
});

test("a package's react-server build renders server code, and its use client exports hydrate", async ({
  page,
  request,
}) => {
  const html = await (await request.get("/compat/rsc-kit")).text();
  expect(html).toContain("hello islands from the server build");
  expect(html).toContain("kit quote about engines, rendered on the server");
  expect(html).not.toContain("client fallback");
  const errors = await open(page, "/compat/rsc-kit");
  const value = page.getByTestId("kit-value");
  await expect(value).toHaveText("kit value: from server");
  await value.click();
  await expect(value).toHaveText("kit value: from server!");
  // A shared module only client components use keeps the package's build for client code.
  const label = page.getByTestId("kit-label");
  await expect(label).toHaveText("kit hook clicks: 0");
  await label.click();
  await expect(label).toHaveText("kit hook clicks: 1");
  expect(errors).toEqual([]);
});

test("TanStack Query: a server prefetch reaches useQuery through HydrationBoundary", async ({
  page,
  request,
}) => {
  // QueryClient and dehydrate are server code; only HydrationBoundary is a client component.
  expect(await (await request.get("/compat/query-hydration")).text()).toContain(
    "prefetched on the server",
  );
  const errors = await open(page, "/compat/query-hydration");
  await expect(page.getByTestId("hydrated-todo")).toHaveText("prefetched on the server");
  expect(errors).toEqual([]);
});

test("motion/react-client animates a motion.div rendered by a server component", async ({
  page,
}) => {
  const errors = await open(page, "/compat/motion");
  await expect(page.getByTestId("motion-box")).toHaveCSS("opacity", "1");
  expect(errors).toEqual([]);
});

test("a package with a CommonJS main and an ES module build renders its default export", async ({
  page,
}) => {
  const errors = await open(page, "/compat/balancer");
  await expect(page.getByTestId("balancer-server")).toContainText("A balanced headline");
  await expect(page.getByTestId("balancer-client")).toContainText("balanced from a client");
  expect(errors).toEqual([]);
});

test("react-tweet's server Tweet renders, with client parts that import CSS modules", async ({
  page,
  request,
}) => {
  expect((await request.get("/compat/tweet")).status()).toBe(200);
  const errors = await open(page, "/compat/tweet");
  await expect(page.getByTestId("tweet")).toBeVisible();
  // The tweet's images and data come from Twitter's CDN, which a sandbox may not reach.
  expect(errors.filter((error) => !/Failed to load resource/.test(error))).toEqual([]);
});

test("react-hook-form's hooks work in a client component", async ({ page }) => {
  const errors = await open(page, "/compat/hook-form");
  await page.getByLabel("hook name").fill("Ada");
  await page.getByRole("button", { name: "Send hook form" }).click();
  await expect(page.getByTestId("hook-form")).toHaveText("sent: Ada");
  expect(errors).toEqual([]);
});

test("lucide-react icons render from a server component and swap in a client component", async ({
  page,
  request,
}) => {
  expect(await (await request.get("/compat/icons")).text()).toContain("lucide-camera");
  const errors = await open(page, "/compat/icons");
  await expect(page.getByTestId("icon-server")).toBeVisible();
  await expect(page.getByLabel("sun")).toBeVisible();
  await page.getByTestId("icon-toggle").click();
  await expect(page.getByLabel("moon")).toBeVisible();
  expect(errors).toEqual([]);
});

test("react-markdown renders markdown in a server component", async ({ page, request }) => {
  const html = await (await request.get("/compat/markdown")).text();
  expect(html).toContain("<h1>Rendered on the server</h1>");
  expect(html).toContain("<strong>bold</strong>");
  const errors = await open(page, "/compat/markdown");
  await expect(page.getByTestId("markdown").getByRole("link")).toHaveAttribute(
    "href",
    "/compat/icons",
  );
  expect(errors).toEqual([]);
});

test("a recharts chart draws server data in a client component", async ({ page }) => {
  const errors = await open(page, "/compat/chart");
  await expect(page.locator("[data-testid=chart] .recharts-bar-rectangle")).toHaveCount(3);
  await expect(page.getByTestId("chart").getByText("Feb")).toBeVisible();
  expect(errors).toEqual([]);
});

test("React Aria Components open and close a dialog from a client component", async ({ page }) => {
  const errors = await open(page, "/compat/aria");
  await page.getByTestId("aria-open").click();
  await expect(page.getByRole("dialog", { name: "Aria dialog" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a cmdk command menu filters its items", async ({ page }) => {
  const errors = await open(page, "/compat/command");
  await page.getByPlaceholder("Search").fill("ban");
  await expect(page.getByRole("option", { name: "Banana" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Apple" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
