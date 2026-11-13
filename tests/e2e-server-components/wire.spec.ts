import { expect, test, type Page } from "@playwright/test";

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
