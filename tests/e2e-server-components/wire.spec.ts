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
