import { expect, type Page, test } from "@playwright/test";

const productionOrigin = "http://localhost:4174";

function captureBrowserErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      const source = message.location().url;
      errors.push(`console${source ? ` (${source})` : ""}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  return errors;
}

test("production API routes retain validation and global middleware", async ({ request }) => {
  const health = await request.get("/api/health", {
    headers: { "x-rsc-request-context": "production" },
  });
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    status: "healthy",
    version: "1.0.0",
    requestContext: "production",
  });
  expect(health.headers()["x-powered-by"]).toBe("Farm.js RSC");
  expect(health.headers()["x-api-version"]).toBe("1.0.0");

  const rewritten = await request.get("/api/request-alias");
  expect(rewritten.status()).toBe(200);
  expect(await rewritten.json()).toEqual({ pathname: "/api/request-url" });

  const hello = await request.get("/api/hello?name=Prod&greeting=Welcome");
  expect(hello.status()).toBe(200);
  expect(await hello.json()).toMatchObject({ message: "Welcome, Prod!" });

  const helloPost = await request.post("/api/hello", {
    data: { name: "Prod" },
    headers: { Origin: productionOrigin },
  });
  expect(helloPost.status()).toBe(200);
  expect(await helloPost.json()).toMatchObject({ message: "Hello, Prod!" });

  const users = await request.get("/api/users?limit=1&offset=1");
  expect(users.status()).toBe(200);
  expect(await users.json()).toMatchObject({
    users: [{ id: "2", name: "Bob" }],
    limit: 1,
    offset: 1,
  });

  const created = await request.post("/api/users", {
    data: { name: "Prod", email: "prod@example.com" },
    headers: { Origin: productionOrigin },
  });
  expect(created.status()).toBe(200);
  expect(await created.json()).toMatchObject({
    success: true,
    user: { name: "Prod", email: "prod@example.com" },
  });

  const echo = await request.post("/api/echo", {
    data: { message: "Prod" },
    headers: { Origin: productionOrigin },
  });
  expect(echo.status()).toBe(200);
  expect(await echo.json()).toMatchObject({ echo: "Prod" });
  expect(echo.headers()["x-frame-options"]).toBe("DENY");
  expect(echo.headers()["x-api-version"]).toBe("1.0.0");

  const missing = await request.get("/api/missing");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");
});

test("SPA navigation keeps document metadata synchronized", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-powered-by"]).toBe("Farm.js RSC");
  await expect(page).toHaveTitle("Home | Farm.js RSC Demo");

  await page.locator('nav a[href="/about"]').click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About React Server Components" })).toBeVisible();
  await expect(page).toHaveTitle("About | Farm.js RSC Demo");

  await page.locator('nav a[href="/server-query"]').click();
  await expect(page).toHaveURL(/\/server-query$/);
  await expect(page).toHaveTitle("Farm.js RSC Demo");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "React Server Components demo with Farm.js",
  );

  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/about$/);
  await expect(page).toHaveTitle("About | Farm.js RSC Demo");

  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle("Home | Farm.js RSC Demo");
});

test("production output hydrates client components", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);

  const response = await page.goto("/counter");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Counter | Farm.js RSC Demo");

  const stylesheet = page.locator('link[rel="stylesheet"]').first();
  await expect(stylesheet).toHaveAttribute("href", /^\/assets\/.+\.css$/);
  const stylesheetHref = await stylesheet.getAttribute("href");
  const stylesheetResponse = await page.request.get(stylesheetHref!);
  expect(stylesheetResponse.status()).toBe(200);
  expect(stylesheetResponse.headers()["content-type"]).toContain("text/css");

  const counter = page.getByRole("heading", { name: "Interactive Counter" }).locator("..");
  const count = counter.locator("span.text-4xl");

  await expect(count).toHaveText("0");
  await counter.getByRole("button", { name: "+", exact: true }).click();
  await expect(count).toHaveText("1");
  await counter.getByRole("button", { name: "-", exact: true }).click();
  await expect(count).toHaveText("0");

  expect(browserErrors).toEqual([]);
});

test("production output executes server actions and refreshes their result", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);

  const response = await page.goto("/form");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Form | Farm.js RSC Demo");
  await expect(page.getByText("No messages yet. Submit one using the form!")).toBeVisible();

  const actionResponsePromise = page.waitForResponse((actionResponse) => {
    const request = actionResponse.request();
    return request.method() === "POST" && Boolean(request.headers()["x-farm-action-id"]);
  });

  await page.getByLabel("Name").fill("Production User");
  await page.getByLabel("Message").fill("Production server action works");
  await page.getByRole("button", { name: "Submit Message" }).click();

  const actionResponse = await actionResponsePromise;
  expect(actionResponse.status()).toBe(200);
  await expect(page.getByTestId("server-action-status")).toHaveText("success");
  await expect(page.getByTestId("server-action-result")).toContainText(
    'Saved message from "Production User".',
  );
  await expect(page.getByLabel("Name")).toHaveValue("");
  await expect(page.getByLabel("Message")).toHaveValue("");
  await expect(page.getByText("Production server action works")).toBeVisible();

  expect(browserErrors).toEqual([]);
});
