import { expect, test } from "@playwright/test";

test.describe("Development runtime error overlay", () => {
  test("shows unhandled client failures and provides recovery controls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 633 });
    await page.goto("/runtime-error-demo");
    await page.getByRole("button", { name: "Trigger runtime error" }).click();

    const overlay = page.getByRole("alertdialog", { name: "Application failed in the browser" });
    await expect(overlay).toBeVisible();
    await expect(overlay.getByText(/Cannot read properties of undefined/)).toBeVisible();
    await expect(overlay.getByText("Window", { exact: true })).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Copy debug report" })).toBeVisible();
    const issueLink = overlay.getByRole("link", { name: "Open GitHub issue" });
    await expect(issueLink).toBeVisible();
    const issueUrl = new URL((await issueLink.getAttribute("href")) || "");
    expect(issueUrl.origin + issueUrl.pathname).toBe(
      "https://github.com/farming-labs/farm.js/issues/new",
    );
    expect(issueUrl.searchParams.get("title")).toContain("Cannot read properties of undefined");
    expect(issueUrl.searchParams.get("body")).toContain("- Page path: /runtime-error-demo");
    await expect(overlay.getByRole("button", { name: "Reload page" })).toBeVisible();

    const statusBox = await overlay.locator(".farm-default-error__code").boundingBox();
    const actionsBox = await overlay.locator(".farm-default-error__actions").boundingBox();
    const viewport = page.viewportSize();
    expect(statusBox?.y).toBeGreaterThanOrEqual(10);
    expect((actionsBox?.y || 0) + (actionsBox?.height || 0)).toBeLessThanOrEqual(
      viewport?.height || 0,
    );

    await overlay.getByRole("button", { name: "Dismiss" }).click();
    await expect(overlay).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Test the browser runtime error overlay" }),
    ).toBeVisible();
  });

  test("follows dark mode for unhandled promise rejections", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/runtime-error-demo");
    await page.getByRole("button", { name: "Trigger rejected promise" }).click();

    const overlay = page.getByRole("alertdialog", { name: "Application failed in the browser" });
    await expect(overlay).toBeVisible();
    await expect(
      overlay.getByText("Intentional rejected promise from the runtime error demo", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(overlay.getByText("Unhandled Rejection", { exact: true })).toBeVisible();
    await expect(
      page.locator("[data-farm-runtime-error-viewport][data-theme='dark']"),
    ).toBeVisible();
  });

  test("keeps the overlay inside a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/runtime-error-demo");
    await page.getByRole("button", { name: "Trigger runtime error" }).click();

    const viewport = page.locator("[data-farm-runtime-error-viewport]");
    await expect(
      page.getByRole("alertdialog", { name: "Application failed in the browser" }),
    ).toBeVisible();
    const dimensions = await viewport.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  });
});
