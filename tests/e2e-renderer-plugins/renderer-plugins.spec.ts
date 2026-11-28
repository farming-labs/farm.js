import { expect, test, type Page } from "@playwright/test";

// @farm.js/prefetch and @farm.js/scroll-restoration on every renderer, in `farm dev` and the
// production build: each project serves a copy of a renderer example with both plugins registered
// (see serve.mjs). Leaf runs in islands mode, where plugins reach a stand-in router until the real
// one loads.

type ProbeWindow = Window & {
  __probePrefetch: string[];
  __probeDocument?: string;
};

function isProduction() {
  return test.info().project.metadata.server === "production";
}

/** Record every href passed to the router's prefetch, on each router object Farm installs. */
async function recordRouterPrefetches(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as ProbeWindow;
    probe.__probePrefetch = [];
    const recorded = new WeakSet<object>();
    let current: unknown;
    Object.defineProperty(window, "__FARM_SPA_ROUTER__", {
      configurable: true,
      get: () => current,
      set(router) {
        current = router;
        if (!router || typeof router.prefetch !== "function" || recorded.has(router)) return;
        recorded.add(router);
        const prefetch = router.prefetch;
        router.prefetch = function (this: unknown, href: string) {
          probe.__probePrefetch.push(String(href));
          return prefetch.call(this, href);
        };
      },
    });
  });
}

function readPrefetches(page: Page) {
  return page.evaluate(() => (window as unknown as ProbeWindow).__probePrefetch);
}

/** Requests for the target page, which only a prefetch or a navigation makes. */
function recordTargetRequests(page: Page, via?: string) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/plugin-probe/target" && url.searchParams.get("via") === (via ?? null)) {
      requests.push(url.pathname + url.search);
    }
  });
  return requests;
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

/** Open the long page once the scroll plugin has started: it tags the history entry on screen. */
async function openProbe(page: Page) {
  await page.goto("/plugin-probe");
  await expect
    .poll(() =>
      page.evaluate(
        () => (history.state as Record<string, unknown> | null)?.__farmScrollEntry ?? null,
      ),
    )
    .not.toBeNull();
  // A value on window survives client navigation and is gone after a document load.
  await page.evaluate(() => {
    (window as unknown as ProbeWindow).__probeDocument = "first";
  });
}

function readDocumentMark(page: Page) {
  return page.evaluate(() => (window as unknown as ProbeWindow).__probeDocument);
}

test("hovering a plain link prefetches it through the router, and the click uses it", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await recordRouterPrefetches(page);
  const requests = recordTargetRequests(page);
  await openProbe(page);

  await page.hover("#probe-link");
  await expect.poll(() => readPrefetches(page)).toContain("/plugin-probe/target");
  // The development router's prefetch fetches nothing; the production one fetches the page.
  if (isProduction()) await expect.poll(() => requests.length).toBe(1);
  const prefetched = requests.length;

  await page.click("#probe-link");
  await expect(page.locator("#probe-target")).toBeVisible();
  await expect(page).toHaveURL(/\/plugin-probe\/target$/);
  expect(await readDocumentMark(page)).toBe("first");
  if (isProduction()) expect(requests).toHaveLength(prefetched);
  expect(errors).toEqual([]);
});

test("a viewport link prefetches once it scrolls into view", async ({ page }) => {
  const errors = collectErrors(page);
  await recordRouterPrefetches(page);
  const requests = recordTargetRequests(page, "viewport");
  await openProbe(page);
  // The router's viewport queue may pass the link's absolute URL.
  const viewportHref = expect.stringContaining("/plugin-probe/target?via=viewport");
  expect(await readPrefetches(page)).not.toContainEqual(viewportHref);

  await page.evaluate(() =>
    document.querySelector("#probe-viewport")!.scrollIntoView({ block: "center" }),
  );
  await expect.poll(() => readPrefetches(page)).toContainEqual(viewportHref);
  if (isProduction()) await expect.poll(() => requests.length).toBe(1);
  expect(errors).toEqual([]);
});

test("Back restores the scroll position after the page renders", async ({ page }) => {
  const errors = collectErrors(page);
  await openProbe(page);
  const entry = await page.evaluate(
    () => (history.state as Record<string, string>).__farmScrollEntry,
  );

  await page.evaluate(() => window.scrollTo(0, 1200));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200);
  // Click from the page: Playwright's click would scroll the link into view first.
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>("#probe-link")!.click());
  await expect(page.locator("#probe-target")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const saved = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    `farm-scroll-restore:${entry}`,
  );
  expect(JSON.parse(saved ?? "null")).toEqual({ x: 0, y: 1200 });

  await page.goBack();
  await expect(page.locator("#probe-title")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200);
  expect(await readDocumentMark(page)).toBe("first");
  expect(
    await page.evaluate(() => (history.state as Record<string, string>).__farmScrollEntry),
  ).toBe(entry);
  expect(errors).toEqual([]);
});
