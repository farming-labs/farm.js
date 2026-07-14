import { expect, test } from "@playwright/test";

const expectedTrace = [
  "session:before",
  "permission:before",
  "audit:before",
  "handler",
  "audit:after",
  "permission:after",
  "session:after",
];

test("server function middleware runs for browser and form calls", async ({ page }) => {
  await page.goto("/server-fn-middleware");

  const output = page.getByTestId("server-middleware-result");

  await page.getByTestId("call-server-middleware").click();
  await expect(output).toContainText('"message":"browser middleware"');
  await expect(output).toContainText('"fromForm":false');

  let result = JSON.parse((await output.textContent()) || "{}");
  expect(result).toMatchObject({
    userId: "middleware-user",
    permission: "messages:write",
    requestMethod: "POST",
    trace: expectedTrace,
  });

  await page.getByTestId("submit-server-middleware-form").click();
  await expect(output).toContainText('"message":"form middleware"');
  await expect(output).toContainText('"fromForm":true');

  result = JSON.parse((await output.textContent()) || "{}");
  expect(result.trace).toEqual(expectedTrace);
});
