import { expect, test } from "@playwright/test";

test.describe("Route-level boundaries", () => {
  test("loading boundary is emitted for suspended route and final content resolves", async ({ page, request }) => {
    const response = await request.get("/boundaries/loading");
    expect(response.status()).toBe(200);

    const html = await response.text();
    const loadingBoundaryIndex = html.indexOf("Route Loading Boundary");
    const finalContentIndex = html.indexOf("Loading route resolved");

    expect(loadingBoundaryIndex).toBeGreaterThanOrEqual(0);
    expect(finalContentIndex).toBeGreaterThanOrEqual(0);
    expect(loadingBoundaryIndex).toBeLessThan(finalContentIndex);

    await page.goto("/boundaries/loading");
    await expect(page.getByTestId("route-loading-final")).toBeVisible();
  });

  test("error boundary renders route-scoped fallback for server render failures", async ({ page, request }) => {
    const response = await request.get("/boundaries/error");
    expect(response.status()).toBe(500);

    const html = await response.text();
    expect(html).toContain("Route Error Boundary");
    expect(html).toContain("Intentional route error for boundary e2e test");

    const pageResponse = await page.goto("/boundaries/error");
    expect(pageResponse?.status()).toBe(500);
    await expect(page.getByTestId("route-error-boundary")).toBeVisible();
    await expect(page.getByTestId("route-error-message")).toContainText(
      "Intentional route error for boundary e2e test",
    );
  });
});
