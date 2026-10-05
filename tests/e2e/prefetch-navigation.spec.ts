import { expect, test } from "@playwright/test";

test("dev navigation reuses an in-flight JSON page-data prefetch", async ({ page }) => {
  const target = "/about?prefetch-overlap=1";
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let requests = 0;
  await page.route("**/__farm/page-data?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("path") !== target) {
      return route.continue();
    }
    requests++;
    started();
    await responseGate;
    await route.continue();
  });

  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  await page.evaluate((path) => {
    const router = (window as any).__FARM_SPA_ROUTER__;
    router.clearCache();
    void router.prefetch(path);
  }, target);
  await requestStarted;

  try {
    // Signal actual entry into the data loader, not a sleep or merely a click.
    // Delegate unchanged to the production router and restore the method immediately.
    await page.evaluate(async (path) => {
      const router = (window as any).__FARM_SPA_ROUTER__;
      const original = router.fetchPageData;
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      router.fetchPageData = function (...args: unknown[]) {
        const result = original.apply(this, args);
        if (args[1] !== false) entered();
        return result;
      };
      try {
        (window as any).__farmTestNavigation = router.navigate(path, { scroll: false });
        await ready;
      } finally {
        router.fetchPageData = original;
      }
    }, target);
  } finally {
    release();
  }

  await page.evaluate(() => (window as any).__farmTestNavigation);
  await expect(page).toHaveURL(/\/about\?prefetch-overlap=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("About");
  expect(requests).toBe(1);
});
