import { expect, test } from "@playwright/test";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";

test.skip(process.env.FARM_E2E_MODE !== "prod", "Generated production HTML router");

for (const prefetch of [false, true]) {
  test(`production redirect preserves the destination URL and history (prefetch: ${prefetch})`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
    if (prefetch) {
      await page.evaluate(() => (window as any).__FARM_SPA_ROUTER__.prefetch("/old-about"));
      await expect(page).toHaveURL(/\/$/);
    }
    await page.evaluate(() => {
      void (window as any).__FARM_SPA_ROUTER__.navigate("/old-about#details");
    });
    await expect(page).toHaveURL(/\/about#details$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("About");
    await expect
      .poll(() => page.evaluate(() => (window as any).__FARM_SPA_ROUTER__?.currentPath))
      .toBe("/about");
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });
}

test("a replaced production redirect does not create an extra history entry", async ({ page }) => {
  await page.goto("/users/123");
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__)).toBe(true);
  await page.evaluate(() => {
    void (window as any).__FARM_SPA_ROUTER__.navigate("/old-about", { replace: true });
  });
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("About");
  await page.goBack();
  await expect(page).toHaveURL(/\/users\/123$/);
});

async function withRedirectServer(
  handler: RequestListener,
  run: (origin: string) => Promise<void>,
) {
  // Redirect destinations need real HTTP responses: browser route interception
  // only handles the initial request of a redirect chain.
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
}

test("a redirect chain preserves destination query and explicit fragment", async ({
  page,
  baseURL,
}) => {
  await withRedirectServer(
    (_request, response) => {
      response.writeHead(307, { location: `${baseURL}/about?redirect=chain#destination` });
      response.end();
    },
    async (origin) => {
      await page.route("**/__redirect-start", (route) =>
        route.fulfill({ status: 302, headers: { location: `${origin}/middle` } }),
      );
      await page.goto("/");
      await expect
        .poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__))
        .toBe(true);
      await page.evaluate(() => {
        void (window as any).__FARM_SPA_ROUTER__.navigate("/__redirect-start#original");
      });
      await expect(page).toHaveURL(/\/about\?redirect=chain#destination$/);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("About");
    },
  );
});

test("cross-origin redirects stay document navigations and are not followed by prefetch", async ({
  page,
}) => {
  let destinationRequests = 0;
  await withRedirectServer(
    (request, response) => {
      if (request.url === "/landing") destinationRequests++;
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<h1>External destination</h1>");
    },
    async (origin) => {
      await page.route("**/__redirect-external", (route) =>
        route.fulfill({ status: 302, headers: { location: `${origin}/landing` } }),
      );
      await page.goto("/");
      await expect
        .poll(() => page.evaluate(() => !!(window as any).__FARM_SPA_ROUTER__))
        .toBe(true);
      await page.evaluate(() =>
        (window as any).__FARM_SPA_ROUTER__.prefetch("/__redirect-external"),
      );
      expect(destinationRequests).toBe(0);
      await expect(page).toHaveURL(/\/$/);
      await page.evaluate(() => {
        void (window as any).__FARM_SPA_ROUTER__.navigate("/__redirect-external");
      });
      await expect(page).toHaveURL(`${origin}/landing`);
      await expect(page.getByRole("heading")).toHaveText("External destination");
      expect(destinationRequests).toBe(1);
    },
  );
});
