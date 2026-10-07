import { expect, test } from "@playwright/test";

test.skip(process.env.FARM_E2E_MODE !== "prod", "Generated production HTML router");

test("production navigation reuses an in-flight HTML prefetch", async ({ page }) => {
  const target = "/about?prefetch-overlap=production";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let requests = 0;
  await page.route("**/about?prefetch-overlap=production", async (route) => {
    requests++;
    started();
    await gate;
    await route.continue();
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  await page.evaluate((path) => {
    (window as any).__farmTestPrefetch = (window as any).__FARM_SPA_ROUTER__.prefetch(path);
  }, target);
  await requestStarted;
  try {
    // Release the server response only after navigation actually enters the
    // HTML loader. This proves overlap without depending on machine timing.
    await page.evaluate(async (path) => {
      const router = (window as any).__FARM_SPA_ROUTER__;
      const original = router.fetchPage;
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      router.fetchPage = function (...args: unknown[]) {
        const result = original.apply(this, args);
        entered();
        return result;
      };
      try {
        (window as any).__farmTestNavigation = router.navigate(path, { scroll: false });
        await ready;
      } finally {
        router.fetchPage = original;
      }
    }, target);
  } finally {
    release();
  }
  await page.evaluate(() =>
    Promise.all([(window as any).__farmTestPrefetch, (window as any).__farmTestNavigation]),
  );
  await expect(page).toHaveURL(/\/about\?prefetch-overlap=production$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("About");
  expect(requests).toBe(1);
});
