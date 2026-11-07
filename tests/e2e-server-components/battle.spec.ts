import { expect, test, type Page } from "@playwright/test";

// Cases real apps hit that the contract does not name: ids, failing islands, portals,
// keyboard input before hydration, element props, nested client trees, long lists,
// failing actions, CSS modules, optimistic updates and form status.
const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("useId gives each field its own id, matching the server's, in every island", async ({
  page,
  request,
}) => {
  const html = await (await request.get("/battle/ids")).text();
  const serverIds = [...html.matchAll(/<input id="([^"]+)"/g)].map((match) => match[1]);
  expect(serverIds).toHaveLength(2);
  expect(new Set(serverIds).size).toBe(2);

  const errors = collectErrors(page);
  await page.goto("/battle/ids");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("First").fill("one");
  await page.getByLabel("Second").fill("two");
  await expect(page.getByTestId("echo-First")).toHaveText("one");
  await expect(page.getByTestId("echo-Second")).toHaveText("two");
  const ids = await page.locator("input").evaluateAll((inputs) => inputs.map((input) => input.id));
  expect(ids).toEqual(serverIds);
  // The id React holds must be the one in the DOM, or later renders and effects point elsewhere.
  await expect(page.getByTestId("id-First")).toHaveText(serverIds[0]!);
  await expect(page.getByTestId("id-Second")).toHaveText(serverIds[1]!);
  expect(errors).toEqual([]);
});

test("an island that throws while hydrating keeps its server HTML and the others still work", async ({
  page,
}) => {
  test.skip(mode !== "islands", "rsc hydrates the page as one root, so the error unmounts it");
  const errors = collectErrors(page);
  await page.goto("/battle/crash");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("clicker-before").click();
  await expect(page.getByTestId("clicker-before")).toHaveText("before: 1");
  await page.getByTestId("clicker-after").click();
  await expect(page.getByTestId("clicker-after")).toHaveText("after: 1");
  await expect(page.getByTestId("crash")).toHaveText("crash server html");
  expect(errors.filter((error) => !error.includes("battle: island crashed"))).toEqual([]);
});

test("a portal opens into the body and closes again", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/battle/portal");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Open dialog" }).click();
  const dialog = page.getByRole("dialog", { name: "Battle dialog" });
  await expect(dialog).toContainText("Portal content");
  expect(await dialog.evaluate((node) => node.parentElement === document.body)).toBe(true);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Enter and Space on a button before it hydrates each count once", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/battle/keyboard");
  await page.waitForLoadState("networkidle");
  const button = page.getByTestId("clicker-keys");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveText("keys: 1");
  await page.keyboard.press("Space");
  await expect(button).toHaveText("keys: 2");
  await expect(button).toBeFocused();
  expect(errors).toEqual([]);
});

test("server elements passed in named and array props render and switch", async ({
  page,
  request,
}) => {
  const html = await (await request.get("/battle/slots")).text();
  expect(html).toContain("server header");
  expect(html).toContain("panel a rendered on the server");
  const errors = collectErrors(page);
  await page.goto("/battle/slots");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("server-header")).toHaveText("server header");
  await page.getByRole("button", { name: "Tab 2" }).click();
  await expect(page.getByTestId("tabs-panel")).toHaveText("panel b rendered on the server");
  await page.getByRole("button", { name: "Tab 1" }).click();
  await expect(page.getByTestId("tabs-panel")).toHaveText("panel a rendered on the server");
  expect(errors).toEqual([]);
});

test("a client component nested in a client component, and an island in its children, keep separate state", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/battle/nested");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "outer 0" }).click();
  await expect(page.getByRole("button", { name: "outer 1" })).toBeVisible();
  await page.getByRole("button", { name: "inner off" }).click();
  await expect(page.getByRole("button", { name: "inner on" })).toBeVisible();
  await page.getByTestId("clicker-inside").click();
  await expect(page.getByTestId("clicker-inside")).toHaveText("inside: 1");
  await page.getByRole("button", { name: "outer 1" }).click();
  await expect(page.getByRole("button", { name: "outer 2" })).toBeVisible();
  await expect(page.getByTestId("clicker-inside")).toHaveText("inside: 1");
  await expect(page.getByTestId("outer-children")).toContainText(
    "server text inside the outer island",
  );
  expect(errors).toEqual([]);
});

test("lists of islands grow and shrink across client navigations, and back restores them", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/battle/list?n=3");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => ((window as { __battleDoc?: number }).__battleDoc = 1));
  await page.getByTestId("clicker-row-2").click();
  await expect(page.getByTestId("clicker-row-2")).toHaveText("row-2: 1");
  await page.getByRole("link", { name: "Forty" }).click();
  await expect(page.getByRole("heading", { name: "List of 40" })).toBeVisible();
  await page.getByTestId("clicker-row-39").click();
  await expect(page.getByTestId("clicker-row-39")).toHaveText("row-39: 1");
  await page.getByRole("link", { name: "Five" }).click();
  await expect(page.getByRole("heading", { name: "List of 5" })).toBeVisible();
  await expect(page.getByTestId("clicker-row-5")).toHaveCount(0);
  await page.getByTestId("clicker-row-4").click();
  await expect(page.getByTestId("clicker-row-4")).toHaveText("row-4: 1");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "List of 40" })).toBeVisible();
  await page.getByTestId("clicker-row-10").click();
  await expect(page.getByTestId("clicker-row-10")).toHaveText("row-10: 1");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "List of 3" })).toBeVisible();
  await page.getByTestId("clicker-row-0").click();
  await expect(page.getByTestId("clicker-row-0")).toHaveText("row-0: 1");
  expect(await page.evaluate(() => (window as { __battleDoc?: number }).__battleDoc)).toBe(1);
  expect(errors).toEqual([]);
});

test("rapid navigations land on the last link clicked", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/battle/list?n=3");
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Forty" }).click();
  await page.getByRole("link", { name: "Five" }).click();
  await page.getByRole("link", { name: "Three" }).click();
  await page.getByRole("link", { name: "Five" }).click();
  await expect(page.getByRole("heading", { name: "List of 5" })).toBeVisible();
  await expect(page).toHaveURL(/n=5$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "List of 5" })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(5);
  await page.getByTestId("clicker-row-1").click();
  await expect(page.getByTestId("clicker-row-1")).toHaveText("row-1: 1");
  expect(errors.filter((error) => !/abort/i.test(error))).toEqual([]);
});

test("an action that throws rejects the call in the client component", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/battle/action-error");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Run failing action" }).click();
  await expect(page.getByTestId("action-error-result")).toHaveText("rejected");
  await page.getByRole("button", { name: "Run failing action" }).click();
  await expect(page.getByTestId("action-error-result")).toHaveText("rejected");
  expect(errors.filter((error) => !/500|the action failed|server/i.test(error))).toEqual([]);
});

test("a CSS module in a client component styles its server HTML before hydration", async ({
  page,
}) => {
  await page.route(/\.m?js(\?|$)/, (route) => route.abort());
  await page.goto("/battle/css");
  const toggle = page.getByTestId("styled-toggle");
  await expect(toggle).toHaveCSS("color", "rgb(1, 2, 3)");
  await expect(toggle).toHaveCSS("border-left-width", "7px");
  await page.unroute(/\.m?js(\?|$)/);
  await page.goto("/battle/css");
  await page.waitForLoadState("networkidle");
  await toggle.click();
  await expect(toggle).toHaveText("styled on");
  await expect(toggle).toHaveCSS("color", "rgb(1, 2, 3)");
});

test("useOptimistic shows the update at once and settles on the action's result", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/battle/optimistic");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Like" }).click();
  await expect(page.getByTestId("likes")).toHaveText("1 pending");
  await expect(page.getByTestId("likes")).toHaveText("1");
  await page.getByRole("button", { name: "Like" }).click();
  await expect(page.getByTestId("likes")).toHaveText("2");
  expect(errors).toEqual([]);
});

test("useFormStatus in a client button shows a server form's pending state", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/battle/form-status");
  await page.waitForLoadState("networkidle");
  const note = `note-${Date.now()}`;
  await page.getByLabel("Note").fill(note);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Saving" })).toBeDisabled();
  await expect(page.getByTestId("saved")).toHaveText(`saved: ${note}`);
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("a client provider in a page gives context to client components in its server children", async ({
  page,
  request,
}) => {
  expect(await (await request.get("/battle/page-context")).text()).toContain("Theme: light");
  const errors = collectErrors(page);
  await page.goto("/battle/page-context");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("theme-label")).toHaveText("Theme: light");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.getByTestId("theme-label")).toHaveText("Theme: dark");
  expect(errors).toEqual([]);
});
