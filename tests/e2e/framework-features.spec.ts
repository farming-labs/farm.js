import { expect, test, type APIRequestContext } from "@playwright/test";

const expectedRuntimeMode = process.env.FARM_E2E_MODE === "prod" ? "prod" : "dev";

async function readFeatureState(request: APIRequestContext) {
  const response = await request.get("/api/feature-lab/state");
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{ mainCalls: number; afterCalls: number }>;
}

test.describe("Framework feature integration", () => {
  test("runs structured plugins across pages, APIs, and short circuits", async ({ request }) => {
    const page = await request.get("/feature-lab");
    expect(page.status()).toBe(200);
    expect(page.headers()["x-farm-runtime-plugin"]).toBe("/feature-lab");
    expect(page.headers()["x-farm-runtime-kind"]).toBe("page");
    expect(page.headers()["x-farm-runtime-pattern"]).toBe("/feature-lab");
    expect(page.headers()["x-farm-layer-plugin"]).toBe("framework-features");
    expect(await page.text()).toContain("<!-- farm-plugin-render:/feature-lab -->");

    const api = await request.get("/api/feature-lab/state");
    expect(api.status()).toBe(200);
    expect(api.headers()["x-farm-runtime-plugin"]).toBe("/api/feature-lab/state");
    expect(api.headers()["x-farm-runtime-kind"]).toBe("api");
    expect(api.headers()["x-farm-runtime-pattern"]).toBe("/api/feature-lab/state");
    expect(api.headers()["x-farm-layer-plugin"]).toBe("framework-features");

    const shortCircuit = await request.get("/feature-lab/runtime-short-circuit");
    expect(shortCircuit.status()).toBe(418);
    expect(shortCircuit.headers()["x-farm-runtime-plugin"]).toBe(
      "/feature-lab/runtime-short-circuit",
    );
    expect(shortCircuit.headers()["x-farm-runtime-kind"]).toBe("page");
    expect(await shortCircuit.text()).toBe("Stopped by the Farm plugin runtime");
  });

  test("composes layers, route rules, redirects, and programmatic routes", async ({ request }) => {
    const lab = await request.get("/feature-lab");
    expect(lab.status()).toBe(200);
    expect(lab.headers()["x-farm-feature-lab"]).toBe("active");
    expect(lab.headers()["x-frame-options"]).toBe("DENY");
    expect(lab.headers()["x-content-type-options"]).toBe("nosniff");

    const configuredRedirect = await request.get("/blog/benchmark-check", {
      maxRedirects: 0,
    });
    expect(configuredRedirect.status()).toBe(307);
    expect(configuredRedirect.headers().location).toBe("/posts/benchmark-check");
    expect(await lab.text()).toContain("Framework feature lab");

    const layer = await request.get("/feature-lab/layer");
    expect(layer.status()).toBe(200);
    expect(layer.headers()["x-farm-feature-lab"]).toBe("active");
    expect(layer.headers()["x-farm-layer"]).toBe("framework-features");
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
    // Initial SSR resolves top-level route state before committing headers so
    // redirects, notFound(), and route errors retain their real HTTP status.
    expect(firstHtml).not.toContain("product-pending");
    expect(firstHtml).toContain("product-reviews-pending");
    expect(firstHtml).toContain("Deferred route data");
    await expect(readFeatureState(request)).resolves.toEqual({
      mainCalls: 1,
      afterCalls: 1,
    });

    const cached = await request.get(routeUrl, {
      headers: { "x-farm-tenant": "acme", "x-request-id": "second" },
    });
    expect(cached.status()).toBe(200);
    expect(await cached.text()).toContain("acme:42:first");
    await expect(readFeatureState(request)).resolves.toEqual({
      mainCalls: 1,
      afterCalls: 2,
    });

    const invalidation = await request.post("/api/feature-lab/cache/42");
    expect(invalidation.ok()).toBeTruthy();
    await expect(invalidation.json()).resolves.toEqual({ invalidated: "42" });

    const refreshed = await request.get(routeUrl, {
      headers: { "x-farm-tenant": "acme", "x-request-id": "third" },
    });
    expect(refreshed.status()).toBe(200);
    expect(await refreshed.text()).toContain("acme:42:third");
    await expect(readFeatureState(request)).resolves.toEqual({
      mainCalls: 2,
      afterCalls: 3,
    });
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

  test("validates multipart uploads and streams typed progress events", async ({ request }) => {
    const response = await request.post("/api/transport-lab", {
      multipart: {
        title: "Framework report",
        file: {
          name: "report.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("farm"),
        },
        tags: "framework",
      },
    });

    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("application/x-ndjson");
    expect(
      (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      {
        phase: "accepted",
        title: "Framework report",
        bytes: 4,
      },
      {
        phase: "complete",
        tags: ["framework"],
      },
    ]);
  });

  test("submits fetcher forms without navigating", async ({ page }) => {
    await page.goto("/feature-lab");

    await page.getByRole("button", { name: "Create user without navigation" }).click();

    await expect(page.getByTestId("fetcher-result")).toHaveText("fetcher@example.com");
    await expect(page.getByTestId("fetcher-state")).toHaveText("idle");
    await expect(page).toHaveURL(/\/feature-lab$/);
  });

  test("hydrates and navigates optional catch-all routes", async ({ page }) => {
    await page.goto("/optional-catchall/one/two");
    await expect(page.getByTestId("optional-catchall-slug")).toHaveText("one/two");

    const counter = page.getByRole("button", { name: "Hydrated count: 0" });
    await counter.click();
    await expect(page.getByRole("button", { name: "Hydrated count: 1" })).toBeVisible();

    await page.getByRole("link", { name: "Open base route" }).click();
    await expect(page).toHaveURL(/\/optional-catchall$/);
    await expect(page.getByTestId("optional-catchall-slug")).toHaveText("base");
  });

  test("renders named route slots and preserves background state during interception", async ({
    page,
    request,
  }) => {
    const direct = await request.get("/slot-lab/photo/42");
    expect(direct.ok()).toBeTruthy();
    const directHtml = await direct.text();
    expect(directHtml).toContain('data-testid="canonical-photo"');
    expect(directHtml).toContain("Canonical photo");

    await page.goto("/slot-lab");
    await expect(page.getByTestId("activity-slot")).toHaveText("Activity slot");

    const count = page.getByRole("button", { name: "Background count: 0" });
    await count.click();
    await expect(page.getByRole("button", { name: "Background count: 1" })).toBeVisible();

    await page.getByTestId("open-intercepted-photo").click();
    await expect(page).toHaveURL(/\/slot-lab\/photo\/42$/);
    await expect(page.getByTestId("intercepted-photo")).toContainText("Intercepted photo 42");
    await expect(page.getByRole("button", { name: "Background count: 1" })).toBeVisible();
    await expect(page.getByTestId("canonical-photo")).toHaveCount(0);

    await page.getByRole("button", { name: "Close photo" }).click();
    await expect(page).toHaveURL(/\/slot-lab$/);
    await expect(page.getByTestId("intercepted-photo")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Background count: 1" })).toBeVisible();
  });

  test("runs client plugins through hydration and SPA navigation", async ({ page }) => {
    await page.goto("/feature-lab");

    await expect
      .poll(() => page.evaluate(() => (window as any).__FARM_CLIENT_PLUGIN_EVENTS__ || []))
      .toEqual([
        `setup:runtime-lifecycle-e2e:feature-lab:${expectedRuntimeMode}`,
        "hydration:before:hydrate",
        "hydration:after:ready",
      ]);
    await expect(page.locator("html")).toHaveAttribute("data-farm-client-plugin", "feature-lab");

    await page.getByTestId("view-transition-link").click();
    await expect(page).toHaveURL(/\/store-e2e$/);

    await expect
      .poll(() => page.evaluate(() => (window as any).__FARM_CLIENT_PLUGIN_EVENTS__ || []))
      .toEqual([
        `setup:runtime-lifecycle-e2e:feature-lab:${expectedRuntimeMode}`,
        "hydration:before:hydrate",
        "hydration:after:ready",
        "navigation:before:/store-e2e",
        "navigation:loaded:/store-e2e",
        "navigation:resolved:/store-e2e",
        "navigation:rendered:/store-e2e",
      ]);
  });

  test("canonicalizes typed search and exposes request route context", async ({ page }) => {
    await page.setExtraHTTPHeaders({
      "x-farm-tenant": "acme",
      "x-request-id": "browser",
    });
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

    const transitionPage = await page.context().newPage();
    try {
      await transitionPage.addInitScript(() => {
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
      await transitionPage.goto("/feature-lab");
      await expect(transitionPage.getByTestId("client-runtime-boundary")).toHaveText(
        "runtime:client",
      );
      await transitionPage.getByTestId("view-transition-link").click();
      await expect(transitionPage).toHaveURL(/\/store-e2e$/);
      await expect
        .poll(() => transitionPage.evaluate(() => (window as any).__FARM_VIEW_TRANSITIONS__))
        .toBe(1);
    } finally {
      await transitionPage.close();
    }
  });

  test("serves static and dynamic metadata images and framework cron routes", async ({
    request,
  }) => {
    const staticMetadata = await request.get("/feature-lab/static-metadata");
    expect(staticMetadata.status()).toBe(200);
    const staticMetadataHtml = await staticMetadata.text();
    const staticImageHref = staticMetadataHtml.match(
      /property="og:image" content="(\/feature-lab\/static-metadata\/opengraph-image\?v=[a-f0-9]{16})"/,
    )?.[1];
    expect(staticImageHref).toBeTruthy();
    expect(staticMetadataHtml).toContain('<meta property="og:image:width" content="1200">');
    expect(staticMetadataHtml).toContain('<meta property="og:image:height" content="630">');
    expect(staticMetadataHtml).toContain(
      '<meta property="og:image:alt" content="Farm.js static metadata image preview">',
    );

    const staticImage = await request.get(staticImageHref!);
    expect(staticImage.status()).toBe(200);
    expect(staticImage.headers()["content-type"]).toBe("image/png");
    expect(staticImage.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");

    const metadata = await request.get("/feature-lab/metadata/7");
    expect(metadata.status()).toBe(200);
    const metadataHtml = await metadata.text();
    expect(metadataHtml).toContain("<title>Metadata product 7</title>");
    expect(metadataHtml).toContain(
      'property="og:image" content="/feature-lab/metadata/7/opengraph-image"',
    );

    const image = await request.get("/feature-lab/metadata/7/opengraph-image");
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
    expect(image.headers()["cache-control"]).toBe(
      "public, s-maxage=300, stale-while-revalidate=300",
    );
    expect(image.headers()["etag"]).toMatch(/^"[a-f0-9]{32}"$/);
    const imageBytes = await image.body();
    expect(imageBytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(imageBytes.readUInt32BE(16)).toBe(1200);
    expect(imageBytes.readUInt32BE(20)).toBe(630);

    const imageHead = await request.head("/feature-lab/metadata/7/opengraph-image");
    expect(imageHead.status()).toBe(200);
    expect(imageHead.headers()["content-type"]).toBe("image/png");
    expect(await imageHead.body()).toHaveLength(0);

    const run = await request.get("/api/maintenance/cleanup", {
      headers: {
        "x-farm-cron-name": "dailyCleanup",
        "x-farm-cron-secret": "farm-production-e2e-secret",
      },
    });
    expect(run.status()).toBe(200);
    expect(await run.json()).toEqual({
      ok: true,
      deleted: 0,
      cron: "dailyCleanup",
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
