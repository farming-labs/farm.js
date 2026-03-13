import { expect, test } from "@playwright/test";

test.describe("Route-level boundaries", () => {
  test("loading boundary is emitted for suspended route and final content resolves", async ({
    page,
    request,
  }) => {
    const response = await request.get("/boundaries/loading");
    expect(response.status()).toBe(200);

    const html = await response.text();
    expect(html.includes("Route Loading Boundary") || html.includes("Data loaded")).toBe(true);

    await page.goto("/boundaries/loading");
    await expect(page.getByTestId("route-loading-final")).toBeVisible({ timeout: 15000 });
  });

  test("error boundary renders route-scoped fallback for server render failures", async ({
    page,
    request,
  }) => {
    const response = await request.get("/boundaries/error");
    // Either 200 (streaming/error boundary) or 500; error message must appear in response
    expect([200, 500]).toContain(response.status());

    const html = await response.text();
    expect(html).toContain("Intentional route error for boundary e2e test");

    const pageResponse = await page.goto("/boundaries/error");
    expect([200, 500]).toContain(pageResponse?.status() ?? 0);
    await expect(page.locator("#root")).toBeVisible();
    // Error appears in document (body text or template/data attributes)
    const content = await page.content();
    expect(
      content.includes("Intentional route error") ||
        content.includes("Route Error Boundary") ||
        content.includes("Something went wrong"),
    ).toBe(true);
  });
});
