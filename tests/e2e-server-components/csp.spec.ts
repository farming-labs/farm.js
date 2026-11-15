import { expect, test, type Page } from "./fixtures";

// A strict nonce Content Security Policy: only scripts with the response's nonce run. The islands
// build has it with FARM_SERVER_COMPONENTS_CSP=nonce (examples/server-components/farm.config.ts).
// Each navigation response carries a nonce of its own, while the page trusts only the nonce of the
// response that loaded the document.
test.skip(
  process.env.FARM_SERVER_COMPONENTS_MODE !== "islands" ||
    process.env.FARM_SERVER_COMPONENTS_CSP !== "nonce",
  "only the islands build with FARM_SERVER_COMPONENTS_CSP=nonce has a nonce policy",
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("the page's responses carry a nonce policy", async ({ request }) => {
  const response = await request.get("/stream");
  expect(response.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
});

test("a streamed client navigation reveals its Suspense content", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => ((window as unknown as { sameDocument: boolean }).sameDocument = true));
  await page.getByRole("link", { name: "Stream", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stream" })).toBeVisible();
  // React's reveal scripts run, so the content replaces its fallback and hydrates.
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

test("a promise prop resolves after a client navigation", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Promise", exact: true }).click();
  // One quote: the reveal script moved the resolved content into place, and the fallback is gone.
  await expect(page.getByTestId("quote")).toHaveText("Promises cross the wire (2026)");
  const like = page.getByRole("button", { name: /^Likes: / });
  await like.click();
  await expect(like).toHaveText("Likes: 1");
  expect(errors).toEqual([]);
});

test("React's form replay script carries the nonce on a page that does not suspend", async ({
  page,
  request,
}) => {
  // Farm renders a page that did not suspend with renderToString from its second request on.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request.get("/server-fn-middleware");
    const nonce = /'nonce-([^']+)'/.exec(response.headers()["content-security-policy"] ?? "")?.[1];
    const replay = /<script([^>]*)>addEventListener\("submit"/.exec(await response.text());
    expect(replay, "the page has a form with a function action").not.toBeNull();
    expect(replay![1]).toContain(`nonce="${nonce}"`);
  }
  const errors = collectErrors(page);
  await page.goto("/server-fn-middleware");
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
