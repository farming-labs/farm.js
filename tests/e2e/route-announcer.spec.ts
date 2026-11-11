import { expect, test, type Page } from "@playwright/test";

// Runs against `farm dev` (the SPA router) and the production build (the generated HTML router).
const ANNOUNCER = "#farm-route-announcer";

/** Console errors, hydration warnings, and uncaught exceptions while the page runs. */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || /hydrat/i.test(message.text())) {
      problems.push(message.text());
    }
  });
  return problems;
}

/** Every text the live region shows, in order, from the moment this is called. */
async function recordAnnouncements(page: Page) {
  await page.evaluate((selector) => {
    const log: string[] = [];
    (window as { __announcements?: string[] }).__announcements = log;
    const region = document.querySelector(selector)!;
    new MutationObserver(() => log.push(region.textContent ?? "")).observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }, ANNOUNCER);
  return () => page.evaluate(() => (window as { __announcements?: string[] }).__announcements);
}

test("client navigations are announced to screen readers, the first load is not", async ({
  page,
  request,
}) => {
  const html = await (await request.get("/")).text();
  expect(html).not.toContain("farm-route-announcer");

  const problems = collectProblems(page);
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  await expect(page).toHaveTitle("Home | Farm.js");
  const announcer = page.locator(ANNOUNCER);
  await expect(announcer).toHaveCount(0);

  await page.locator('nav a[href="/about"]').click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(announcer).toHaveText("About | Farm.js");
  await expect(announcer).toHaveAttribute("aria-live", "assertive");
  await expect(announcer).toHaveAttribute("aria-atomic", "true");
  // Visually hidden, but in the accessibility tree.
  const box = await announcer.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(1);
  expect(box?.height).toBeLessThanOrEqual(1);
  expect(await announcer.evaluate((node) => getComputedStyle(node).display)).not.toBe("none");

  // A hash change on the same page announces nothing; the next page is the only entry.
  const announcements = await recordAnnouncements(page);
  await page.evaluate(() => (window as any).__FARM_SPA_ROUTER__.navigate("#details"));
  await expect(page).toHaveURL(/\/about#details$/);
  await page.locator('nav a[href="/contact"]').click();
  await expect(announcer).toHaveText("Contact | Farm.js");
  expect(await announcements()).toEqual(["", "Contact | Farm.js"]);

  // Back and forward announce the page they show.
  await page.goBack();
  await expect(page).toHaveURL(/\/about#details$/);
  await expect(announcer).toHaveText("About | Farm.js");
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(announcer).toHaveText("Home | Farm.js");
  await page.goForward();
  await expect(page).toHaveURL(/\/about$/);
  await expect(announcer).toHaveText("About | Farm.js");

  await expect(page.locator(ANNOUNCER)).toHaveCount(1);
  expect(problems).toEqual([]);
});
