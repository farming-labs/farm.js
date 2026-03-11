import { expect, test } from "@playwright/test";

test.describe("Link prefetch controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/prefetch-e2e");
    await page.getByTestId("clear-logs").click();
  });

  test("prefetch=render prefetches after mount", async ({ page }) => {
    await page.waitForTimeout(150);
    const logs = await page.evaluate(() => window.__FARM_PREFETCH_E2E__?.getLogs() || []);
    expect(logs.some((log: { href: string }) => log.href.includes("mode=render"))).toBeTruthy();
  });

  test("prefetch=intent prefetches on hover", async ({ page }) => {
    await page.getByTestId("link-intent").hover();
    await page.waitForTimeout(80);
    const logs = await page.evaluate(() => window.__FARM_PREFETCH_E2E__?.getLogs() || []);
    expect(logs.some((log: { href: string }) => log.href.includes("mode=intent"))).toBeTruthy();
  });

  test("prefetch=none does not prefetch on hover", async ({ page }) => {
    await page.getByTestId("link-none").hover();
    await page.waitForTimeout(120);
    const logs = await page.evaluate(() => window.__FARM_PREFETCH_E2E__?.getLogs() || []);
    expect(logs.some((log: { href: string }) => log.href.includes("mode=none"))).toBeFalsy();
  });

  test("prefetch=viewport prefetches when link enters viewport", async ({ page }) => {
    await page.getByTestId("link-viewport").scrollIntoViewIfNeeded();
    await page.waitForTimeout(220);
    const logs = await page.evaluate(() => window.__FARM_PREFETCH_E2E__?.getLogs() || []);
    expect(logs.some((log: { href: string }) => log.href.includes("mode=viewport"))).toBeTruthy();
  });

  test("prefetch=intent prefetches on keyboard focus", async ({ page }) => {
    await page.getByTestId("link-intent").focus();
    await page.waitForTimeout(80);
    const logs = await page.evaluate(() => window.__FARM_PREFETCH_E2E__?.getLogs() || []);
    expect(logs.some((log: { href: string }) => log.href.includes("mode=intent"))).toBeTruthy();
  });

  test("prefetch=intent cancels when blurred before delay", async ({ page }) => {
    await page.getByTestId("link-intent-cancel").focus();
    await page.waitForTimeout(80);
    await page.getByTestId("clear-logs").focus();
    await page.waitForTimeout(260);
    const logs = await page.evaluate(() => window.__FARM_PREFETCH_E2E__?.getLogs() || []);
    expect(
      logs.some((log: { href: string }) => log.href.includes("mode=intent-cancel")),
    ).toBeFalsy();
  });

  test("prefetch=hover (legacy alias) still prefetches", async ({ page }) => {
    await page.getByTestId("link-hover-legacy").hover();
    await page.waitForTimeout(80);
    const logs = await page.evaluate(() => window.__FARM_PREFETCH_E2E__?.getLogs() || []);
    expect(
      logs.some((log: { href: string }) => log.href.includes("mode=hover-legacy")),
    ).toBeTruthy();
  });

  test("prefetch=true prefetches when entering viewport", async ({ page }) => {
    await page.getByTestId("link-true").scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const logs = await page.evaluate(() => window.__FARM_PREFETCH_E2E__?.getLogs() || []);
    expect(logs.some((log: { href: string }) => log.href.includes("mode=true"))).toBeTruthy();
  });

  test("external links never prefetch", async ({ page }) => {
    await page.waitForTimeout(200);
    const logs = await page.evaluate(() => window.__FARM_PREFETCH_E2E__?.getLogs() || []);
    expect(
      logs.some((log: { href: string }) => log.href.startsWith("https://example.com")),
    ).toBeFalsy();
  });
});
