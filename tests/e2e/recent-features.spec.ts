import { expect, test, type APIRequestContext } from "@playwright/test";

async function readFeatureState(request: APIRequestContext) {
  const response = await request.get("/api/feature-lab/state");
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{ mainCalls: number; afterCalls: number }>;
}

test.describe("Recent feature integration", () => {
  test("composes layers, route rules, redirects, and programmatic routes", async ({ request }) => {
    const lab = await request.get("/feature-lab");
    expect(lab.status()).toBe(200);
    expect(lab.headers()["x-farm-feature-lab"]).toBe("active");
    expect(await lab.text()).toContain("Recent features lab");

    const layer = await request.get("/feature-lab/layer");
    expect(layer.status()).toBe(200);
    expect(layer.headers()["x-farm-feature-lab"]).toBe("active");
    expect(layer.headers()["x-farm-layer"]).toBe("recent-features");
    expect(await layer.text()).toContain("Layer route is active");

    const routeRuleRedirect = await request.get("/feature-lab/route-rule-redirect", {
      maxRedirects: 0,
    });
    expect(routeRuleRedirect.status()).toBe(307);
    expect(routeRuleRedirect.headers().location).toBe("/feature-lab");

    const programmaticRedirect = await request.get("/feature-lab/legacy/42", {
      maxRedirects: 0,
    });
    expect(programmaticRedirect.status()).toBe(307);
    expect(programmaticRedirect.headers().location).toBe("/feature-lab/products/42");

    const staticRoute = await request.get("/feature-lab/static/alpha");
    expect(staticRoute.status()).toBe(200);
    const staticHtml = await staticRoute.text();
    expect(staticHtml).toContain("Static feature:");
    expect(staticHtml).toContain("alpha");
  });

  test("runs typed route data with context, caching, and path invalidation", async ({
    request,
  }) => {
    const reset = await request.delete("/api/feature-lab/state");
    expect(reset.ok()).toBeTruthy();

    const routeUrl = "/feature-lab/products/42?tab=info&locale=am&toast=saved";
    const first = await request.get(routeUrl, {
      headers: { "x-farm-tenant": "acme", "x-request-id": "first" },
    });
    expect(first.status()).toBe(200);
    expect(first.headers()["x-farm-feature-lab"]).toBe("active");
    const firstHtml = await first.text();
    expect(firstHtml).toContain("acme:42:first");
    expect(firstHtml).toContain("server:https://api.example.com:FARM_SERVER_BOUNDARY_SENTINEL");
    expect(firstHtml).toContain("runtime:server");
    expect(firstHtml).toContain("product-pending");
    expect(firstHtml).toContain("product-reviews-pending");
    expect(firstHtml).toContain("Deferred route data");
    await expect(readFeatureState(request)).resolves.toEqual({ mainCalls: 1, afterCalls: 1 });

    const cached = await request.get(routeUrl, {
      headers: { "x-farm-tenant": "acme", "x-request-id": "second" },
    });
    expect(cached.status()).toBe(200);
    expect(await cached.text()).toContain("acme:42:first");
    await expect(readFeatureState(request)).resolves.toEqual({ mainCalls: 1, afterCalls: 2 });

    const invalidation = await request.post("/api/feature-lab/cache/42");
    expect(invalidation.ok()).toBeTruthy();
    await expect(invalidation.json()).resolves.toEqual({ invalidated: "42" });

    const refreshed = await request.get(routeUrl, {
      headers: { "x-farm-tenant": "acme", "x-request-id": "third" },
    });
    expect(refreshed.status()).toBe(200);
    expect(await refreshed.text()).toContain("acme:42:third");
    await expect(readFeatureState(request)).resolves.toEqual({ mainCalls: 2, afterCalls: 3 });
  });

  test("applies guards and programmatic route state components", async ({ request }) => {
    const guarded = await request.get("/feature-lab/products/42?access=denied", {
      maxRedirects: 0,
    });
    expect(guarded.status()).toBe(307);
    expect(guarded.headers().location).toBe("/feature-lab/login");

    const missing = await request.get("/feature-lab/products/missing");
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain("Product was not found.");

    const failed = await request.get("/feature-lab/products/error");
    expect(failed.status()).toBe(500);
    expect(await failed.text()).toContain("Feature product failed to load.");
  });

  test("hydrates public env and client-only environment branches", async ({ page }) => {
    await page.goto("/feature-lab");

    await expect(page.getByTestId("public-env")).toHaveText("My Farm.js App");
    await expect(page.getByTestId("client-boundary")).toHaveText(
      "client:My Farm.js App:/feature-lab",
    );
    await expect(page.getByTestId("client-runtime-boundary")).toHaveText("runtime:client");
  });

  test("canonicalizes typed search and exposes request route context", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-farm-tenant": "acme", "x-request-id": "browser" });
    await page.goto("/feature-lab/products/44?tab=info&locale=am&toast=saved");

    await expect(page.getByTestId("product-tab")).toHaveText("info");
    await expect(page.getByTestId("product-locale")).toHaveText("am");
    await expect(page.getByTestId("product-tenant")).toHaveText("acme");
    await expect(page.getByTestId("product-before")).toHaveText("acme:44:browser");
    await expect(page.getByTestId("product-reviews")).toContainText("Deferred route data");
    await expect(page).toHaveURL(/\/feature-lab\/products\/44\?locale=am$/);
  });

  test("supports page state, blocking, pending navigation, and view transitions", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as any).__FARM_VIEW_TRANSITIONS__ = 0;
      (document as any).startViewTransition = (update: () => void | Promise<void>) => {
        (window as any).__FARM_VIEW_TRANSITIONS__ += 1;
        const updateCallbackDone = Promise.resolve().then(update);
        return {
          ready: Promise.resolve(),
          updateCallbackDone,
          finished: updateCallbackDone,
          skipTransition() {},
        };
      };
    });
    await page.goto("/feature-lab");

    await page.getByTestId("push-page-state").click();
    await expect(page.getByTestId("page-state")).toHaveText("details");
    await page.getByTestId("replace-page-state").click();
    await expect(page.getByTestId("page-state")).toHaveText("activity");

    await page.getByTestId("dirty-toggle").check();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByTestId("layer-link").click();
    await expect(page).toHaveURL(/\/feature-lab$/);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("layer-link").click();
    await expect(page).toHaveURL(/\/feature-lab\/layer$/);

    await page.goto("/feature-lab");
    await page.getByTestId("unprefetched-product-link").click();
    await expect(page.getByTestId("navigation-state")).toContainText(
      "loading:/feature-lab/products/43",
    );
    await expect(page).toHaveURL(/\/feature-lab\/products\/43/);

    await page.goto("/feature-lab");
    await expect(page.getByTestId("client-runtime-boundary")).toHaveText("runtime:client");
    const typedProductHref = new URL(
      (await page.getByTestId("typed-product-link").getAttribute("href"))!,
      page.url(),
    );
    expect(typedProductHref.pathname).toBe("/feature-lab/products/42");
    expect(typedProductHref.searchParams.get("tab")).toBe("reviews");
    expect(typedProductHref.searchParams.get("locale")).toBe("am");
    expect(typedProductHref.searchParams.get("toast")).toBe("opened");

    await page.getByTestId("view-transition-link").click();
    await expect(page).toHaveURL(/\/store-e2e$/);
    expect(await page.evaluate(() => (window as any).__FARM_VIEW_TRANSITIONS__)).toBe(1);
  });

  test("serves dynamic metadata images and executable workflows", async ({ request }) => {
    const metadata = await request.get("/feature-lab/metadata/7");
    expect(metadata.status()).toBe(200);
    const metadataHtml = await metadata.text();
    expect(metadataHtml).toContain("<title>Metadata product 7</title>");
    expect(metadataHtml).toContain(
      'property="og:image" content="/feature-lab/metadata/7/opengraph-image"',
    );

    const image = await request.get("/feature-lab/metadata/7/opengraph-image");
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/svg+xml");
    expect(await image.text()).toContain("Feature product 7");

    const workflows = await request.get("/api/_farm/workflows");
    expect(workflows.status()).toBe(200);
    expect(await workflows.json()).toEqual({
      workflows: [
        {
          id: "daily-cleanup",
          description: "Example scheduled cleanup task.",
          schedule: ["0 2 * * *"],
          timezone: null,
          path: "/api/_farm/workflows/daily-cleanup",
        },
      ],
    });

    const run = await request.get("/api/_farm/workflows/daily-cleanup");
    expect(run.status()).toBe(200);
    expect(await run.json()).toEqual({
      id: "daily-cleanup",
      ok: true,
      result: { deleted: 0 },
    });
  });

  test("runs integration handlers and typed browser and server callers", async ({
    page,
    request,
  }) => {
    const invalid = await request.post("/api/route-lab/message", {
      data: { message: "" },
    });
    expect(invalid.status()).toBe(400);

    const directRoute = await request.post("/api/route-lab/message", {
      data: { message: "direct-routes" },
      headers: { "x-request-id": "integration-direct" },
    });
    expect(directRoute.status()).toBe(200);
    expect(directRoute.headers()["x-integration-after"]).toBe("routes");
    await expect(directRoute.json()).resolves.toEqual(
      expect.objectContaining({
        source: "routes",
        message: "direct-routes",
        caller: "direct",
        requestId: "integration-direct",
        trace: ["integration-middleware", "route-middleware", "before", "handler"],
        lifecycle: {
          label: "configured",
          setup: true,
          ready: true,
        },
      }),
    );

    const directEndpoint = await request.post("/api/endpoint-lab/message", {
      data: { message: "direct-endpoints" },
    });
    expect(directEndpoint.status()).toBe(200);
    expect(directEndpoint.headers()["x-integration-after"]).toBe("endpoints");
    await expect(directEndpoint.json()).resolves.toEqual(
      expect.objectContaining({
        source: "endpoints",
        message: "direct-endpoints",
        caller: "direct",
        trace: ["handler"],
      }),
    );

    const directContract = await request.post("/api/contract-lab/message", {
      data: { message: "direct-api" },
    });
    expect(directContract.status()).toBe(200);
    expect(directContract.headers()["x-integration-after"]).toBe("api");
    await expect(directContract.json()).resolves.toEqual(
      expect.objectContaining({
        source: "api",
        message: "direct-api",
        caller: "direct",
        trace: ["handler"],
      }),
    );

    const serverCallers = await request.get("/api/integration-lab/server");
    expect(serverCallers.status()).toBe(200);
    await expect(serverCallers.json()).resolves.toEqual(
      expect.objectContaining({
        routes: expect.objectContaining({
          source: "routes",
          message: "server-routes",
          caller: "server",
        }),
        endpoints: expect.objectContaining({
          source: "endpoints",
          message: "server-endpoints",
          caller: "server",
        }),
        api: expect.objectContaining({
          source: "api",
          message: "server-api",
          caller: "server",
        }),
      }),
    );

    await page.goto("/feature-lab/integrations");

    await page.getByTestId("call-integration-routes").click();
    await expect(page.getByTestId("integration-client-routes")).toContainText(
      '"message":"browser-routes"',
    );
    await expect(page.getByTestId("integration-client-routes")).toContainText('"caller":"browser"');

    await page.getByTestId("call-integration-endpoints").click();
    await expect(page.getByTestId("integration-client-endpoints")).toContainText(
      '"message":"browser-endpoints"',
    );

    await page.getByTestId("call-integration-api").click();
    await expect(page.getByTestId("integration-client-api")).toContainText(
      '"message":"browser-api"',
    );
  });
});
