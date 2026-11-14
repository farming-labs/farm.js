import { expect, test, type Page } from "@playwright/test";

const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("a plain function passed to a client component fails the render, as React Server Components refuse it", async ({
  request,
}) => {
  const response = await request.get("/wire/function-prop");
  expect(response.status()).toBe(500);
  expect(await response.text()).not.toContain(">Pick</button>");
});

test("a stream passed as a prop reaches the client component chunk by chunk", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/wire/stream-prop");
  await expect(page.getByTestId("readable")).toHaveText("alpha beta gamma (done)");
  await expect(page.getByTestId("iterable")).toHaveText("one two (done)");
  expect(errors).toEqual([]);
});

test("an action returns a stream and a promise that settle after it returned", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/wire/stream-result");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Launch" }).click();
  await expect(page.getByTestId("countdown")).toHaveText("3 2 1 (done)");
  await expect(page.getByTestId("launch-status")).toHaveText("launched");
  expect(errors).toEqual([]);
});

test("a value that refers to itself reaches a client component and a server action, and comes back", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/wire/circular");
  await page.waitForLoadState("networkidle");
  const node = page.getByRole("button", { name: /^root / });
  await node.click();
  await expect(node).toHaveText("root true 1");
  await page.getByRole("button", { name: "Echo" }).click();
  await expect(page.getByTestId("echo")).toHaveText("root true true");
  expect(errors).toEqual([]);
});

test("elements a promise resolves to render with live client components, as a prop and as an action's result", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/wire/promise-element");
  await page.waitForLoadState("networkidle");
  const promised = page.getByRole("button", { name: /^Promised:/ });
  await expect(promised).toHaveText("Promised: 2");
  await promised.click();
  await expect(promised).toHaveText("Promised: 3");
  await page.getByRole("button", { name: "Reveal" }).click();
  const revealed = page.getByRole("button", { name: /^Revealed:/ });
  await expect(revealed).toHaveText("Revealed: 7");
  await revealed.click();
  await expect(revealed).toHaveText("Revealed: 8");
  expect(errors).toEqual([]);
});

test("a promise that settles to the object holding it gives back that object, as a prop and as an action's result", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/wire/promise-cycle");
  await page.waitForLoadState("networkidle");
  const view = page.getByRole("button", { name: /^holder / });
  await expect(view).toHaveText("holder true 0");
  await view.click();
  await expect(view).toHaveText("holder true 1");
  await page.getByRole("button", { name: "Hold", exact: true }).click();
  await expect(page.getByTestId("reply")).toHaveText("reply true");
  expect(errors).toEqual([]);
});

test("maps with elements, global symbols, errors, iterators, blobs and form data reach a client component and come back from an action", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/wire/kinds");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("props")).toHaveText("true true ab 4 text/plain page");
  const panel = page.getByRole("button", { name: /^Panel:/ });
  await expect(panel).toHaveText("Panel: 1");
  await panel.click();
  await expect(panel).toHaveText("Panel: 2");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("reply")).toHaveText("true true xy 4 text/plain reply");
  const mapped = page.getByRole("button", { name: /^Mapped:/ });
  await expect(mapped).toHaveText("Mapped: 5");
  await mapped.click();
  await expect(mapped).toHaveText("Mapped: 6");
  expect(errors).toEqual([]);
});

test("values the browser sends to an action come back as the same values, as React Server Components return temporary references", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/wire/round-trip");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Echo", exact: true }).click();
  await expect(page.getByTestId("echo")).toHaveText("true true true");
  await expect(page.getByTestId("badge")).toHaveText("sent from the browser");
  expect(errors).toEqual([]);
});

test("an action bound in the browser can be sent to another action, which runs it with its captured and bound values", async ({
  page,
}) => {
  test.fail(
    mode === "rsc",
    "React's browser client keeps Function.prototype.bind on server references, so rsc mode sends a bound action as a temporary reference",
  );
  const errors = collectErrors(page);
  await page.goto("/wire/round-trip");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("run")).toHaveText("bound call");
  await page.getByRole("button", { name: "Greet", exact: true }).click();
  await expect(page.getByTestId("greet")).toHaveText("hello kinfe, hello bound call");
  expect(errors).toEqual([]);
});
