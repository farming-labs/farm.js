import { brotliCompressSync } from "node:zlib";
import { expect, test } from "@playwright/test";

const routes = [
  ["/", "React Server Components"],
  ["/about", "About React Server Components"],
  ["/counter", "Client Components"],
  ["/form", "Server Actions"],
  ["/server-fn-middleware", "Server function middleware"],
  ["/server-query", "Unified server queries"],
  ["/after", "Post-response work"],
  ["/static-content", "Optimized boundary comparison"],
] as const;

test("all RSC example pages render successfully with the optimized boundary enabled", async ({
  page,
}) => {
  for (const [route, heading] of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
});

test("the optimized boundary renders safe equivalent content", async ({ page }) => {
  const response = await page.goto("/static-content?mode=optimized");
  expect(response?.status()).toBe(200);

  const fragment = page.locator('article[data-static-content="optimized"]');
  await expect(fragment).toHaveAttribute("data-strata", /^[a-f0-9]{64}$/);
  await expect(fragment.locator("section")).toHaveCount(36);
  await expect(fragment.locator("section").first()).toContainText(
    "streaming without React-owned interior nodes",
  );
  await expect(fragment).toContainText(
    '<script>globalThis.__strataInjected = true</script> & "quotes".',
  );
  await expect(fragment.getByRole("link", { name: "Read the Strata source" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );

  expect(
    await page.evaluate(
      () => (globalThis as typeof globalThis & { __strataInjected?: boolean }).__strataInjected,
    ),
  ).toBeUndefined();
});

test("switching representations preserves surrounding client state", async ({ page }) => {
  await page.goto("/static-content?mode=optimized");

  const counter = page.getByRole("heading", { name: "Interactive Counter" }).locator("..");
  const value = counter.locator("span.text-4xl");
  await counter.getByRole("button", { name: "+", exact: true }).click();
  await expect(value).toHaveText("1");

  await page.locator('[data-mode-link="react"]').click();
  await expect(page).toHaveURL(/\/static-content\?mode=react$/);
  await expect(page.locator('article[data-static-content="react"]')).toBeVisible();
  await expect(value).toHaveText("1");

  await page.locator('[data-mode-link="optimized"]').click();
  await expect(page).toHaveURL(/\/static-content\?mode=optimized$/);
  await expect(page.locator('article[data-static-content="optimized"]')).toBeVisible();
  await expect(value).toHaveText("1");
});

test("optimized host content reduces the equivalent Flight payload", async ({
  request,
}, testInfo) => {
  const headers = { Accept: "text/x-component" };
  const [optimizedResponse, reactResponse] = await Promise.all([
    request.get("/static-content?mode=optimized", { headers }),
    request.get("/static-content?mode=react", { headers }),
  ]);

  expect(optimizedResponse.status()).toBe(200);
  expect(reactResponse.status()).toBe(200);

  const optimized = await optimizedResponse.body();
  const react = await reactResponse.body();
  const measurement = {
    optimizedRawBytes: optimized.byteLength,
    reactRawBytes: react.byteLength,
    optimizedBrotliBytes: brotliCompressSync(optimized).byteLength,
    reactBrotliBytes: brotliCompressSync(react).byteLength,
  };

  await testInfo.attach("optimized-boundary-flight-payloads.json", {
    body: Buffer.from(`${JSON.stringify(measurement, null, 2)}\n`),
    contentType: "application/json",
  });

  expect(measurement.optimizedRawBytes).toBeLessThan(measurement.reactRawBytes);
  expect(measurement.optimizedBrotliBytes).toBeLessThan(measurement.reactBrotliBytes);
});
