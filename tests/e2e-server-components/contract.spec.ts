import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./fixtures";

// The server components contract. Every test runs against the same app built with
// { mode: "rsc" } and with { mode: "islands" } (playwright.server-components.config.ts).
const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";
const dev = process.env.FARM_SERVER_COMPONENTS_SERVER === "dev";
const target = dev ? undefined : process.env.FARM_SERVER_COMPONENTS_TARGET;
const output = path.resolve(
  "examples/server-components",
  `.farm/.output-${mode}${target ? `-${target}` : ""}`,
);
// Where the build puts its static files: Cloudflare Pages serves the output directory itself.
const publicDir =
  target === "cloudflare" ? output : path.join(output, target === "vercel" ? "static" : "public");

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

test("a server layout around a client provider keeps its code on the server", async ({ page }) => {
  const scripts: string[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() === "script") scripts.push(await response.text());
  });
  const errors = collectErrors(page);
  // Into the provider's layout from a page whose layouts render on the server only, and back.
  await page.goto("/");
  await hydrated(page);
  await page.evaluate(() => ((window as { __contract?: number }).__contract = 1));
  await page.getByRole("link", { name: "Context" }).click();
  await expect(page.getByRole("heading", { name: "Context" })).toBeVisible();
  await expect(page.getByText("Layout note: contract-layout-server-only-2b7e1d")).toBeVisible();
  await hydrated(page);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.getByTestId("theme-label")).toHaveText("Theme: dark");
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("link", { name: "Context" }).click();
  await hydrated(page);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.getByTestId("theme-label")).not.toHaveText("Theme: none");
  expect(await page.evaluate(() => (window as { __contract?: number }).__contract)).toBe(1);
  expect(scripts.length).toBeGreaterThan(0);
  for (const source of scripts) expect(source).not.toContain("contract-layout-server-only-2b7e1d");
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

test("client components before and inside slow Suspense content both hydrate", async ({
  page,
  request,
}) => {
  // The slow content waits for this release instead of a timer, so the body streams until then.
  const token = randomUUID();
  const release = async () =>
    expect((await request.get(`/stream?release=${token}`)).ok()).toBe(true);
  await page.goto(`/stream?hold=${token}`, { waitUntil: "commit" });
  const early = page.getByRole("button", { name: /^Early: / });
  // Islands mode starts the client while the body streams, in development too: the Early counter
  // works before the slow content is released. The RSC client starts once the stream ends.
  if (mode !== "islands") await release();
  await expect(async () => {
    await early.click({ timeout: 100 });
    await expect(early).toHaveText(/^Early: [1-9]/, { timeout: 50 });
  }).toPass({ intervals: [20], timeout: 10_000 });
  if (mode === "islands") {
    expect(await page.evaluate(() => document.readyState)).toBe("loading");
    expect(await page.getByTestId("slow-content").count()).toBe(0);
    await release();
  }

  const late = page.getByRole("button", { name: /^Late: / });
  await expect(page.getByTestId("slow-content")).toBeVisible();
  await expect(async () => {
    await late.click({ timeout: 200 });
    await expect(late).toHaveText(/^Late: [1-9]/, { timeout: 100 });
  }).toPass({ timeout: 10_000 });
});

test("a client navigation shows a Suspense page before its slow content arrives", async ({
  page,
}) => {
  test.skip(mode !== "islands", "islands navigations stream");
  const errors = collectErrors(page);
  await page.goto("/");
  await hydrated(page);
  await page.evaluate(() => ((window as unknown as { sameDocument: boolean }).sameDocument = true));
  await page.getByRole("link", { name: "Stream", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stream" })).toBeVisible();
  await expect(page.getByTestId("slow-fallback")).toBeVisible();
  expect(await page.getByTestId("slow-content").count()).toBe(0);
  await expect(page).toHaveURL(/\/stream$/);
  const early = page.getByRole("button", { name: /^Early: / });
  await early.click();
  await expect(early).toHaveText("Early: 1");

  await expect(page.getByTestId("slow-content")).toBeVisible();
  await expect(page.getByTestId("slow-fallback")).toHaveCount(0);
  const late = page.getByRole("button", { name: /^Late: / });
  await late.click();
  await expect(late).toHaveText("Late: 1");
  expect(
    await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("a navigation request gets the layouts it keeps as boundaries, and flush markers", async ({
  baseURL,
  request,
}) => {
  test.skip(
    mode !== "islands",
    "islands mode's navigation protocol, the same in dev and production",
  );
  // F-Layouts names the layouts the browser shows, by key: the root renders, the rest are kept.
  const segment = await request.get("/nav/b", {
    headers: { Accept: "text/html", "F-Layouts": JSON.stringify(["/", "/nav"]) },
  });
  const html = await segment.text();
  expect(html).toContain(
    'data-farm-layout-pattern="/" data-farm-layout-key="/" style="display:contents"',
  );
  expect(html).toContain('data-farm-layout-key="/nav" data-farm-layout-kept="true"');
  expect(html).toContain("Nav page B");
  expect(segment.headers()["cache-control"]).toBe("private, no-store");
  // A layout chain that hydrates (a client provider in /context's layout) is drawn by React in the
  // browser, without keys, so the server leaves them out there.
  const hydrating = await (
    await request.get("/context", { headers: { Accept: "text/html" } })
  ).text();
  expect(hydrating).toContain('data-farm-layout-pattern="/context"');
  expect(hydrating).not.toContain("data-farm-layout-key");

  // The header is the browser's word, so a layout that guards its pages still runs.
  const keptGuard = JSON.stringify(["/", "/guarded"]);
  for (const headers of [
    { Accept: "text/html" },
    { Accept: "text/html", "F-Layouts": keptGuard },
  ]) {
    const denied = await request.get("/guarded", { headers });
    expect(denied.status()).toBe(404);
    expect(await denied.text()).not.toContain("Guarded page");
  }
  const allowed = await request.get("/guarded", {
    headers: { Accept: "text/html", "F-Layouts": keptGuard, "X-Guard": "allow" },
  });
  expect(allowed.status()).toBe(200);
  const allowedHtml = await allowed.text();
  expect(allowedHtml).toContain("Guarded page");
  expect(allowedHtml).toContain('data-farm-layout-key="/guarded" data-farm-layout-kept="true"');
  expect(allowedHtml).not.toContain("Guarded layout");
  // Running a layout with a client island in it does not cost the segment.
  const island = await (
    await request.get("/action-layout", {
      headers: { Accept: "text/html", "F-Layouts": JSON.stringify(["/", "/action-layout"]) },
    })
  ).text();
  expect(island).toContain('data-farm-layout-key="/action-layout" data-farm-layout-kept="true"');

  // F-Stream: flush marks where each React flush ends, with the token from F-Flush.
  const streamed = await fetch(`${baseURL}/stream`, {
    headers: { Accept: "text/html", "F-Stream": "flush" },
  });
  const token = streamed.headers.get("f-flush");
  expect(token).toMatch(/^[0-9a-f]{32}$/);
  const [shell, ...flushes] = (await streamed.text()).split(`<!--farm-flush:${token}-->`);
  expect(shell).toContain("Loading slow content");
  expect(shell).not.toContain("Slow content arrived");
  expect(flushes.join("")).toContain("Slow content arrived");
});

test("leaving a streaming page drops the rest of its content", async ({ page }) => {
  test.skip(mode !== "islands", "islands navigations stream");
  const errors = collectErrors(page);
  await page.goto("/");
  await hydrated(page);
  const streamRequest = page.waitForRequest((request) => request.url().endsWith("/stream"));
  await page.getByRole("link", { name: "Stream", exact: true }).click();
  const request = await streamRequest;
  const streamEnded = new Promise<void>((resolve) => {
    const end = (ended: typeof request) => ended === request && resolve();
    page.on("requestfinished", end);
    page.on("requestfailed", end);
  });
  await expect(page.getByTestId("slow-fallback")).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("slow-fallback")).toHaveCount(0);
  // Whether the browser dropped the response or it finished, the slow content never shows.
  await streamEnded;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await page.getByTestId("slow-content").count()).toBe(0);
  expect(await page.locator('div[hidden][id^="S:"]').count()).toBe(0);
  expect(errors).toEqual([]);
});

test("a promise passed to a client component streams in, and the component works before it", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/promise", { waitUntil: "commit" });
  const like = page.getByRole("button", { name: /^Likes: / });
  let quoteArrivedFirst = true;
  await expect(async () => {
    await like.click({ timeout: 100 });
    await expect(like).toHaveText(/^Likes: [1-9]/, { timeout: 50 });
    quoteArrivedFirst = (await page.getByTestId("quote").count()) > 0;
  }).toPass({ intervals: [20], timeout: 10_000 });
  // As with Suspense content: islands start while the body streams, RSC once it ends.
  if (mode === "islands") expect(quoteArrivedFirst).toBe(false);
  // The resolved value keeps its types (a Date).
  await expect(page.getByTestId("quote")).toHaveText("Promises cross the wire (2026)");
  await expect(page.getByTestId("quote-fallback")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a promise prop resolves after a client navigation", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await hydrated(page);
  await page.getByRole("link", { name: "Promise", exact: true }).click();
  await expect(page.getByTestId("quote")).toHaveText("Promises cross the wire (2026)");
  const like = page.getByRole("button", { name: /^Likes: / });
  await like.click();
  await expect(like).toHaveText("Likes: 1");
  expect(errors).toEqual([]);
});

test("generateMetadata sets the head", async ({ request }) => {
  const html = await (await request.get("/meta")).text();
  expect(html).toContain("<title>Contract meta 42</title>");
  expect(html).toMatch(/<meta name="description" content="Metadata from generateMetadata"/);
});

test("static pages are prerendered at build time", async ({ request }) => {
  test.skip(dev, "build output only");
  expect(existsSync(path.join(publicDir, "static/a/index.html"))).toBe(true);
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
  // The document and navigation requests, replayed with the same headers once the test is done:
  // the server answers from them (F-Values, F-Layouts), and Chrome may already have dropped a
  // response body by the time a listener asks for it.
  const requests: Array<Promise<{ url: string; headers: Record<string, string> }>> = [];
  page.on("request", (request) => {
    const type = request.resourceType();
    if (type === "document" || type === "fetch") {
      requests.push(request.allHeaders().then((headers) => ({ url: request.url(), headers })));
    }
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
    const documents: string[] = [];
    for (const { url, headers } of await Promise.all(requests)) {
      const sent = Object.fromEntries(
        Object.entries(headers).filter(
          ([name]) => !["host", "connection", "content-length"].includes(name),
        ),
      );
      documents.push(await (await page.request.get(url, { headers: sent })).text());
    }
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

test("a request that renders twice still sends every value its islands reference", async ({
  request,
}) => {
  test.skip(mode !== "islands", "values are islands mode's wire format");
  const valuesOf = (html: string) => ({
    referenced: new Set(
      [...html.matchAll(/\{"\$":"r","v":"([0-9a-z]{14})"\}/g)].map((match) => match[1]),
    ),
    sent: new Set(
      [...html.matchAll(/<script type="f\/value" name="([0-9a-z]{14})">/g)].map(
        (match) => match[1],
      ),
    ),
  });
  // Renders that do not suspend teach the route to render synchronously first; a request that
  // suspends then renders twice, and the second render is the one the browser receives.
  for (const query of ["", "", `?slow=${Date.now()}`]) {
    const html = await (await request.get(`/values/slow${query}`)).text();
    const { referenced, sent } = valuesOf(html);
    expect(referenced.size).toBeGreaterThan(0);
    for (const key of referenced) expect(sent).toContain(key);
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

test("a server action that removes an item keeps each client component's state with its key", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto(`/action-keyed?list=${test.info().workerIndex}-${Date.now()}`);
  await hydrated(page);
  for (const label of ["Component Grace", "Parent Grace"]) {
    const button = page.getByRole("button", { name: new RegExp(`^${label}:`) });
    await button.click();
    await expect(button).toHaveText(`${label}: 1`);
    await button.click();
    await expect(button).toHaveText(`${label}: 2`);
  }

  await page.getByRole("button", { name: "Remove first" }).click();
  await expect(page.getByRole("button", { name: /^Component Ada:/ })).toHaveCount(0);
  // React keeps state by key: Grace keeps her count, and Linus, now in Grace's place, does not take it.
  for (const kind of ["Component", "Parent"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${kind} Grace:`) })).toHaveText(
      `${kind} Grace: 2`,
    );
    await expect(page.getByRole("button", { name: new RegExp(`^${kind} Linus:`) })).toHaveText(
      `${kind} Linus: 0`,
    );
  }
  expect(errors).toEqual([]);
});

test("a server action reads what route middleware put in its context", async ({ page }) => {
  await page.goto("/action-middleware");
  await hydrated(page);
  await page.getByRole("button", { name: "Record user" }).click();
  await expect(page.getByTestId("action-user")).toHaveText("Ada");
});

test("a server action updates the server layout around its page and keeps the layout's client state", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/action-layout");
  await hydrated(page);
  const count = async (id: string) =>
    Number((await page.getByTestId(id).textContent())?.replace(/\D/g, ""));
  const layout = await count("layout-count");
  const button = page.getByRole("button", { name: /^Layout clicks/ });
  await button.click();
  await expect(button).toHaveText("Layout clicks: 1");
  await page.getByRole("button", { name: "Bump layout" }).click();
  await expect(page.getByTestId("layout-count")).toHaveText(`Layout count: ${layout + 1}`);
  await expect(button).toHaveText("Layout clicks: 1");
  expect(errors).toEqual([]);
});

test("a server action that leaves its layout unchanged keeps what was typed there", async ({
  page,
}) => {
  await page.goto("/action-layout");
  await hydrated(page);
  const pageCount = Number(
    (await page.getByTestId("page-count").textContent())?.replace(/\D/g, ""),
  );
  // A form posts natively until the client runtime runs, and this click loads it.
  const button = page.getByRole("button", { name: /^Layout clicks/ });
  await button.click();
  await expect(button).toHaveText("Layout clicks: 1");
  await expect(page.getByTestId("layout-streamed")).toBeVisible();
  await page.getByLabel("Layout note").fill("still here");
  await page.getByRole("button", { name: "Bump page" }).click();
  await expect(page.getByTestId("page-count")).toHaveText(`Page count: ${pageCount + 1}`);
  await expect(page.getByLabel("Layout note")).toHaveValue("still here");
});

test("a server route slot stays on the server, and its client component hydrates", async ({
  page,
}) => {
  test.skip(mode !== "islands", "the rsc pipeline does not render route slots");
  const errors = collectErrors(page);
  const scripts: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script")
      scripts.push(response.text().catch(() => ""));
  });
  await page.goto("/slots");
  await hydrated(page);
  await expect(page.getByTestId("slot-note")).toHaveText("SERVER_SLOT_MARKER_6f1c");
  const button = page.getByRole("button", { name: /^Slot clicks/ });
  await button.click();
  await expect(button).toHaveText("Slot clicks: 1");
  await page.waitForLoadState("networkidle");
  expect(
    (await Promise.all(scripts)).filter((text) => text.includes("SERVER_SLOT_MARKER")),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("a declared failure from a form posted before JavaScript loads keeps its status", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/action-nojs");
  const response = page.waitForResponse((candidate) => candidate.request().method() === "POST");
  await page.getByRole("button", { name: "Reserve" }).click();
  expect((await response).status()).toBe(409);
  await context.close();
});

test("useActionState shows the action's result after a form posted before JavaScript loads", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/action-state");
  await expect(page.getByTestId("vote-result")).toHaveText("votes: 0, last: none");
  await page.getByLabel("Choice").fill("coffee");
  await page.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(page.getByTestId("vote-result")).toHaveText("votes: 1, last: coffee");
  await context.close();
});

test("an island hydrates with the useActionState result of a form posted before it loaded", async ({
  page,
}) => {
  const errors = collectErrors(page);
  // The first page loads without its scripts, so the form posts as HTML; the response loads them.
  let blocked = true;
  await page.route(
    (url) => url.pathname.endsWith(".js"),
    (route) => (blocked ? route.abort() : route.continue()),
  );
  await page.goto("/action-state");
  await page.getByLabel("Choice").fill("coffee");
  blocked = false;
  await page.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(page.getByTestId("vote-result")).toHaveText("votes: 1, last: coffee");
  await page.waitForLoadState("networkidle");
  // Hydrated: the island's own state works, and it kept the action's result.
  await page.getByRole("button", { name: "Vote form clicks: 0" }).click();
  await expect(page.getByRole("button", { name: "Vote form clicks: 1" })).toBeVisible();
  await expect(page.getByTestId("vote-result")).toHaveText("votes: 1, last: coffee");
  // And the form keeps going from that state (the response rendered the field's default again).
  await page.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(page.getByTestId("vote-result")).toHaveText("votes: 2, last: tea");
  expect(errors.filter((error) => !error.includes("net::ERR_FAILED"))).toEqual([]);
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

test("an inline server action reads its page's variables, from a form and from a client component", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/inline");
  await hydrated(page);
  // The captured values travel sealed, never as readable form fields. The sealed value is
  // base64url, so "Ada" may turn up inside it by chance: only a standalone word is a leak.
  expect(await page.content()).not.toMatch(/(?<![\w-])Ada(?![\w-])/);
  await page.evaluate(() => ((window as { __contract?: number }).__contract = 1));
  await page.getByRole("button", { name: "Inline clicks: 0" }).click();

  const fromPage = `page item ${Date.now()}`;
  await page.getByLabel("Page item").fill(fromPage);
  await page.getByRole("button", { name: "Add from page" }).click();
  await expect(page.getByTestId("items")).toContainText(`${fromPage} (inline, Ada since 2026)`);

  const fromIsland = `island item ${Date.now()}`;
  await page.getByLabel("Item", { exact: true }).fill(fromIsland);
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByTestId("items")).toContainText(`${fromIsland} (inline, Ada since 2026)`);
  // No document load, and client state survived both refreshes.
  await expect(page.getByRole("button", { name: "Inline clicks: 1" })).toBeVisible();
  expect(await page.evaluate(() => (window as { __contract?: number }).__contract)).toBe(1);
  expect(errors).toEqual([]);
});

test("an inline server action works before JavaScript loads", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/inline");
  const title = `no-js inline item ${Date.now()}`;
  await page.getByLabel("Page item").fill(title);
  await page.getByRole("button", { name: "Add from page" }).click();
  await expect(page.getByTestId("items")).toContainText(`${title} (inline, Ada since 2026)`);
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

test("middleware runs for API routes, and API routes keep their validation", async ({
  baseURL,
  request,
}) => {
  const echo = await request.get("/api/echo?word=hi");
  expect(echo.status()).toBe(200);
  expect(await echo.json()).toEqual({ echo: "hi" });
  expect(echo.headers()["x-contract-middleware"]).toBe("api");
  // Middleware rewrites to another API route.
  expect(await (await request.get("/api/alias")).json()).toEqual({ echo: "rewritten" });
  const posted = await request.post("/api/echo", {
    data: { word: "posted" },
    headers: { Origin: baseURL! },
  });
  expect(await posted.json()).toEqual({ echo: "posted" });
  const invalid = await request.post("/api/echo", {
    data: { word: "" },
    headers: { Origin: baseURL! },
  });
  expect(invalid.status()).toBe(400);
  expect((await request.get("/api/missing")).status()).toBe(404);
});

test("after() runs once the response has finished", async ({ page, request }) => {
  const token = randomUUID();
  const written = async () =>
    (
      (await (await request.get(`/api/after?token=${token}`)).json()) as {
        written: { token: string; scheduledAt: number; completedAt: number } | null;
      }
    ).written;
  const response = await page.goto(`/after?token=${token}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("after-status")).toHaveText("scheduled");
  expect(await written()).toBeNull();
  await expect.poll(async () => (await written())?.token).toBe(token);
  const record = (await written())!;
  expect(record.completedAt - record.scheduledAt).toBeGreaterThanOrEqual(500);
});

test("server function middleware runs in order for browser and form calls", async ({ page }) => {
  const trace = [
    "session:before",
    "permission:before",
    "audit:before",
    "handler",
    "audit:after",
    "permission:after",
    "session:after",
  ];
  const errors = collectErrors(page);
  await page.goto("/server-fn-middleware");
  await hydrated(page);
  const output = page.getByTestId("middleware-result");
  await page.getByRole("button", { name: "Call with middleware" }).click();
  await expect(output).toContainText('"message":"from the browser"');
  expect(JSON.parse((await output.textContent()) || "{}")).toMatchObject({
    user: "contract-user",
    permission: "notes:write",
    method: "POST",
    fromForm: false,
    trace,
  });
  await page.getByRole("button", { name: "Submit with middleware" }).click();
  await expect(output).toContainText('"message":"from a form"');
  expect(JSON.parse((await output.textContent()) || "{}")).toMatchObject({ fromForm: true, trace });
  expect(errors).toEqual([]);
});

test("server queries prefetch, dedupe, and refetch after an invalidation", async ({ page }) => {
  const errors = collectErrors(page);
  let calls = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.resourceType() === "fetch") calls++;
  });
  await page.goto("/server-query");
  await hydrated(page);
  await page.getByRole("button", { name: "Prefetch product" }).click();
  await expect(page.getByTestId("prefetch-status")).toHaveText(/^prefetched:\d+:\d+$/);
  const [, version, queried] = (await page.getByTestId("prefetch-status").textContent())!.split(
    ":",
  );
  expect(calls).toBe(1);
  // Two consumers of the prefetched key read the cache: no request.
  await page.getByRole("button", { name: "Show products" }).click();
  const first = page.getByTestId("product-first");
  await expect(first).toContainText(`"version":${version}`);
  await expect(first).toContainText(`"calls":${queried}`);
  await expect(page.getByTestId("product-second")).toHaveText((await first.textContent())!);
  expect(calls).toBe(1);
  // The update invalidates the key: both consumers refetch it once.
  await page.getByRole("button", { name: "Update product" }).click();
  await expect(first).toContainText(`"version":${Number(version) + 1}`);
  await expect(first).toContainText(`"calls":${Number(queried) + 1}`);
  await expect(page.getByTestId("product-second")).toHaveText((await first.textContent())!);
  expect(calls).toBe(3);
  expect(errors).toEqual([]);
});

test("navigation keeps the document title in sync, and back restores it", async ({ page }) => {
  await page.goto("/");
  await hydrated(page);
  await expect(page).toHaveTitle("Server components contract");
  await page.getByRole("link", { name: "Meta", exact: true }).click();
  await expect(page).toHaveTitle("Contract meta 42");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Metadata from generateMetadata",
  );
  await page.getByRole("link", { name: "Queries", exact: true }).click();
  await expect(page).toHaveTitle("Contract server queries");
  await page.goBack();
  await expect(page).toHaveTitle("Contract meta 42");
  await page.goBack();
  await expect(page).toHaveTitle("Server components contract");
});

test("a client navigation is announced to screen readers, and the first load is not", async ({
  page,
  request,
}) => {
  expect(await (await request.get("/")).text()).not.toContain("farm-route-announcer");
  const errors = collectErrors(page);
  await page.goto("/");
  await hydrated(page);
  const announcer = page.locator("#farm-route-announcer");
  await expect(announcer).toHaveCount(0);
  await page.getByRole("link", { name: "Meta", exact: true }).click();
  await expect(announcer).toHaveText("Contract meta 42");
  await expect(announcer).toHaveAttribute("aria-live", "assertive");
  await expect(announcer).toHaveAttribute("aria-atomic", "true");
  await page.goBack();
  await expect(page).toHaveTitle("Server components contract");
  await expect(announcer).toHaveText("Server components contract");
  await expect(announcer).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("the app's stylesheet loads", async ({ page }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="stylesheet"]').first().getAttribute("href");
  expect(href).toBeTruthy();
  // As a <link> asks for it: Vite's dev server answers a bare CSS URL as a module.
  const stylesheet = await page.request.get(href!, { headers: { Accept: "text/css,*/*;q=0.1" } });
  expect(stylesheet.status()).toBe(200);
  expect(stylesheet.headers()["content-type"]).toContain("text/css");
  expect(await page.locator(".shell nav").evaluate((nav) => getComputedStyle(nav).display)).toBe(
    "flex",
  );
});

test("client components use Farm's router hooks, page state, blocker and Link", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/hooks");
  await hydrated(page);
  for (const probe of ["router", "navigation", "page-state", "blocker", "link"]) {
    await expect(page.getByTestId(`probe-${probe}`)).toHaveAttribute("data-ready", "true");
  }
  await expect(page.getByTestId("probe-router")).toHaveText("router: function");
  await expect(page.getByTestId("probe-navigation")).toHaveText("navigation: idle");
  await page.getByRole("button", { name: "page state: none" }).click();
  await expect(page.getByRole("button", { name: "page state: details" })).toBeVisible();
  await page.getByRole("link", { name: "link home" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});

// Hydration timing: `export const island = "interaction" | "visible" | "idle"` in a client module
// (/timing has one island of each). Each island keeps its own trigger.
test("an interaction island stays server HTML until it is clicked, and counts that click", async ({
  page,
}) => {
  test.skip(mode !== "islands", "rsc hydrates every client component on load");
  const errors = collectErrors(page);
  await page.goto("/timing");
  await hydrated(page);
  const island = page.getByTestId("interaction");
  await expect(island).toHaveText("Interaction: 0");
  await expect(island).toHaveAttribute("data-hydrated", "false");
  await island.click();
  await expect(island).toHaveAttribute("data-hydrated", "true");
  await expect(island).toHaveText("Interaction: 1");
  expect(errors).toEqual([]);
});

test("a visible island hydrates when it scrolls into view", async ({ page }) => {
  test.skip(mode !== "islands", "rsc hydrates every client component on load");
  const errors = collectErrors(page);
  await page.goto("/timing");
  await hydrated(page);
  const island = page.getByTestId("visible");
  await expect(island).toHaveAttribute("data-hydrated", "false");
  await island.scrollIntoViewIfNeeded();
  await expect(island).toHaveAttribute("data-hydrated", "true");
  await island.click();
  await expect(island).toHaveText("Visible: 1");
  expect(errors).toEqual([]);
});

test("an idle island hydrates without input, and leaves the other islands waiting", async ({
  page,
}) => {
  test.skip(mode !== "islands", "rsc hydrates every client component on load");
  const errors = collectErrors(page);
  await page.goto("/timing");
  const island = page.getByTestId("idle");
  await expect(island).toHaveAttribute("data-hydrated", "true");
  await island.click();
  await expect(island).toHaveText("Idle: 1");
  await expect(page.getByTestId("interaction")).toHaveAttribute("data-hydrated", "false");
  await expect(page.getByTestId("visible")).toHaveAttribute("data-hydrated", "false");
  expect(errors).toEqual([]);
});

// The client runtime (React, islx, the router) loads when a page first needs it: at once when an
// island hydrates at load, otherwise on an island's own trigger or a link (RFC 0003, section 10).
// /timing/later has an interaction island, a link, and a visible island below the fold.
function scriptRequests(page: Page): string[] {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
  });
  return scripts;
}

/** Production's client entry, or farm dev's. */
function isClientRuntime(pathname: string): boolean {
  return /^\/farm-client-h[0-9a-f]+\.js$/.test(pathname) || pathname === "/@farm/client.js";
}

test("a page with an island that hydrates at load loads the client runtime at once", async ({
  page,
}) => {
  test.skip(mode !== "islands", "rsc hydrates every client component on load");
  const scripts = scriptRequests(page);
  // /window's island reads the window in an effect, so it hydrates at load.
  await page.goto("/window");
  await hydrated(page);
  expect(scripts.filter(isClientRuntime)).toHaveLength(1);
});

test("a page whose islands all hydrate later loads the client runtime when one is due", async ({
  page,
}) => {
  test.skip(mode !== "islands", "rsc hydrates every client component on load");
  const errors = collectErrors(page);
  const scripts = scriptRequests(page);
  await page.goto("/timing/later");
  await hydrated(page);
  expect(scripts.filter(isClientRuntime)).toEqual([]);
  await page.getByTestId("visible").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("visible")).toHaveAttribute("data-hydrated", "true");
  expect(scripts.filter(isClientRuntime)).toHaveLength(1);
  await expect(page.getByTestId("interaction")).toHaveAttribute("data-hydrated", "false");
  expect(errors).toEqual([]);
});

test("a click on an island before the client runtime loads is replayed once it hydrates", async ({
  page,
}) => {
  test.skip(mode !== "islands", "rsc hydrates every client component on load");
  const errors = collectErrors(page);
  const scripts = scriptRequests(page);
  await page.goto("/timing/later");
  await hydrated(page);
  expect(scripts.filter(isClientRuntime)).toEqual([]);
  const island = page.getByTestId("interaction");
  await island.click();
  await expect(island).toHaveAttribute("data-hydrated", "true");
  await expect(island).toHaveText("Interaction: 1");
  expect(errors).toEqual([]);
});

test("every click on an island while its code loads is replayed once it hydrates", async ({
  page,
}) => {
  test.skip(mode !== "islands", "rsc hydrates every client component on load");
  const errors = collectErrors(page);
  // The runtime is held until both clicks are in, so neither lands after hydration.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => isClientRuntime(url.pathname),
    async (route) => {
      await released;
      await route.continue();
    },
  );
  await page.goto("/timing/later");
  await hydrated(page);
  const island = page.getByTestId("interaction");
  await island.click();
  await island.click();
  await expect(island).toHaveAttribute("data-hydrated", "false");
  release();
  await expect(island).toHaveAttribute("data-hydrated", "true");
  await expect(island).toHaveText("Interaction: 2");
  expect(errors).toEqual([]);
});

test("a link followed before the client runtime loads is a client navigation", async ({ page }) => {
  test.skip(mode !== "islands", "rsc hydrates every client component on load");
  const errors = collectErrors(page);
  const scripts = scriptRequests(page);
  await page.goto("/timing/later");
  await hydrated(page);
  expect(scripts.filter(isClientRuntime)).toEqual([]);
  await page.evaluate(() => Object.assign(window, { __farmSameDocument: true }));
  // A click with no pointer before it: nothing has started the runtime, so the click is held.
  await page.getByRole("link", { name: "To timing" }).dispatchEvent("click");
  await expect(page).toHaveURL(/\/timing$/);
  await expect(page.getByRole("heading", { name: "Timing", exact: true })).toBeVisible();
  expect(await page.evaluate(() => "__farmSameDocument" in window)).toBe(true);
  expect(errors).toEqual([]);
});

test("a page that hydrates loads the router only when a navigation needs it", async ({ page }) => {
  test.skip(mode !== "islands" || dev, "the production islands client entry splits its router");
  const errors = collectErrors(page);
  const routerRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("farm-client-router")) routerRequests.push(request.url());
  });
  await page.goto("/");
  await hydrated(page);
  expect(routerRequests).toEqual([]);
  const increment = page.getByRole("button", { name: /Count: 5/ });
  await increment.click();
  await expect(page.getByRole("button", { name: /Count: 6/ })).toBeVisible();
  expect(routerRequests).toEqual([]);

  await page.evaluate(() => Object.assign(window, { __farmSameDocument: true }));
  const link = page.getByRole("link", { name: "Stream", exact: true });
  await link.hover();
  await expect.poll(() => routerRequests.length).toBe(1);
  await link.click();
  await expect(page.getByRole("heading", { name: "Stream" })).toBeVisible();
  expect(await page.evaluate(() => "__farmSameDocument" in window)).toBe(true);
  expect(routerRequests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("a link still navigates when the router fails to load", async ({ page }) => {
  test.skip(mode !== "islands" || dev, "the production islands client entry splits its router");
  let aborted = 0;
  await page.route("**/farm-client-router-*", (route) => {
    aborted += 1;
    return route.abort();
  });
  await page.goto("/");
  await hydrated(page);
  // The counter's click starts the client entry, which watches for link intent.
  await page.getByRole("button", { name: /Count: 5/ }).click();
  await expect(page.getByRole("button", { name: /Count: 6/ })).toBeVisible();
  await page.evaluate(() => Object.assign(window, { __farmSameDocument: true }));
  const link = page.getByRole("link", { name: "Stream", exact: true });
  // A hover that fails leaves the page alone: it must not reload what the visitor is reading.
  await link.hover();
  await expect.poll(() => aborted).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => "__farmSameDocument" in window)).toBe(true);
  await link.click();
  await expect(page).toHaveURL(/\/stream$/);
  await expect(page.getByRole("heading", { name: "Stream" })).toBeVisible();
  // A new document: the browser navigated itself, without the router.
  expect(await page.evaluate(() => "__farmSameDocument" in window)).toBe(false);
});

test("a link still navigates when the client runtime fails to load", async ({ page, request }) => {
  test.skip(mode !== "islands", "rsc hydrates every client component on load");
  const html = await (await request.get("/timing/later")).text();
  const runtime = /<script[^>]*\sdata-farm-runtime="([^"]+)"/.exec(html)?.[1];
  expect(runtime).toMatch(/^\/(farm-client-h[0-9a-f]+\.js|@farm\/client\.js)$/);
  const blocked: string[] = [];
  await page.route(
    (url) => url.pathname === runtime,
    (route) => {
      blocked.push(route.request().url());
      return route.abort();
    },
  );
  await page.goto("/timing/later");
  await hydrated(page);
  await page.evaluate(() => Object.assign(window, { __farmSameDocument: true }));
  await page.getByRole("link", { name: "To timing" }).dispatchEvent("click");
  await expect(page).toHaveURL(/\/timing$/);
  await expect(page.getByRole("heading", { name: "Timing", exact: true })).toBeVisible();
  // A new document: the browser navigated itself, without the runtime.
  expect(await page.evaluate(() => "__farmSameDocument" in window)).toBe(false);
  expect(blocked.length).toBeGreaterThan(0);
});
