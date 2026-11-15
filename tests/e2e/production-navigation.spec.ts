import { expect, test } from "@playwright/test";

test.skip(process.env.FARM_E2E_MODE !== "prod", "Generated production HTML router");

test("production relative navigation and prefetch keep the current document path", async ({
  page,
}) => {
  await page.goto("/users/123?tab=profile");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "fetch") {
      const url = new URL(request.url());
      requests.push(url.pathname + url.search);
    }
  });
  await page.evaluate(async () => {
    const router = (window as any).__FARM_SPA_ROUTER__;
    await router.prefetch("?tab=settings");
    await router.navigate("?tab=settings", { scroll: false });
  });
  await expect(page).toHaveURL(/\/users\/123\?tab=settings$/);
  expect(requests.filter((path) => path === "/users/123?tab=settings")).toHaveLength(1);
  expect(requests).not.toContain("/?tab=settings");

  await page.evaluate(() => (window as any).__FARM_SPA_ROUTER__.navigate("456", { scroll: false }));
  await expect(page).toHaveURL(/\/users\/456$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("456");
  const beforeHash = requests.length;
  await page.evaluate(() =>
    (window as any).__FARM_SPA_ROUTER__.navigate("#details", { scroll: false }),
  );
  await expect(page).toHaveURL(/\/users\/456#details$/);
  expect(requests).toHaveLength(beforeHash);
});

test("production plain links to API routes load the response as a document", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  // A root-layout anchor to a feed or other API route, not a Farm <Link>.
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.id = "api-document-link";
    link.setAttribute("href", "/api/hello?name=Farm");
    link.textContent = "API";
    document.body.append(link);
  });
  await page.click("#api-document-link");
  await expect(page).toHaveURL(/\/api\/hello\?name=Farm$/);
  await expect.poll(() => page.evaluate(() => document.contentType)).toBe("application/json");
  await expect(page.locator("body")).toContainText("Hello Peeps, Farm!");
});
