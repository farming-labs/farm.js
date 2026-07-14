import { expect, test } from "@playwright/test";

test("server queries prefetch, dedupe, and refetch after invalidation", async ({ page }) => {
  let actionRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["x-farm-action-id"]) {
      actionRequests++;
    }
  });

  await page.goto("/server-query");

  await page.getByTestId("prefetch-product-query").click();
  await expect(page.getByTestId("product-prefetch-status")).toHaveText("prefetched:1:1");
  expect(actionRequests).toBe(1);

  await page.getByTestId("show-product-consumers").click();
  const first = page.getByTestId("product-query-first");
  const second = page.getByTestId("product-query-second");
  await expect(first).toContainText('"version":1');
  await expect(first).toContainText('"queryCalls":1');
  await expect(second).toHaveText((await first.textContent()) ?? "");
  expect(actionRequests).toBe(1);

  await page.getByTestId("update-product-query").click();
  await expect(first).toContainText('"version":2');
  await expect(first).toContainText('"queryCalls":2');
  await expect(second).toHaveText((await first.textContent()) ?? "");
  expect(actionRequests).toBe(3);
});
