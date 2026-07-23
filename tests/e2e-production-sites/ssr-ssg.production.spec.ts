import { access } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const timestampPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

test.beforeAll(async () => {
  await Promise.all([
    access("examples/ssr-ssg-demo/.vercel/output/server/index.mjs"),
    access("examples/ssr-ssg-demo/.vercel/output/public/farm-client.js"),
  ]);
});

test("serves SSR and middleware-covered SSG routes safely", async ({ page }) => {
  const firstHomeResponse = await page.goto("/");
  expect(firstHomeResponse?.ok()).toBe(true);
  expect(firstHomeResponse?.headers()["x-farm-demo"]).toBe("SSR-SSG-Demo");
  await expect(page.getByRole("heading", { name: "Welcome to Farm.js", level: 1 })).toBeVisible();

  const firstServerTime = await page.getByText(timestampPattern).first().textContent();
  await page.waitForTimeout(10);
  await page.reload();
  const secondServerTime = await page.getByText(timestampPattern).first().textContent();
  expect(secondServerTime).not.toBe(firstServerTime);

  await page.getByRole("link", { name: "About (SSG)", exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About Us", level: 1 })).toBeVisible();
  const firstOriginTime = await page.getByText(timestampPattern).first().textContent();
  await page.reload();
  const secondOriginTime = await page.getByText(timestampPattern).first().textContent();
  expect(secondOriginTime).not.toBe(firstOriginTime);

  await page.getByRole("link", { name: "Blog", exact: true }).click();
  await expect(page).toHaveURL(/\/blog\/hello-world$/);
  await expect(
    page.getByRole("heading", {
      name: "Hello World - Getting Started with Farm.js",
      level: 1,
    }),
  ).toBeVisible();

  const productsResponse = await page.goto("/products");
  expect(productsResponse?.ok()).toBe(true);
  expect(productsResponse?.headers()["cache-control"]).toBe(
    "public, s-maxage=60, stale-while-revalidate=300",
  );
  await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Farm.js Pro", level: 2 })).toBeVisible();
});

test("hydrates client navigation and preserves middleware in production", async ({ page }) => {
  const response = await page.goto("/dashboard");

  expect(response?.ok()).toBe(true);
  expect(response?.headers()["x-dashboard-access"]).toBe("granted");
  expect(response?.headers()["x-auth-status"]).toBe("demo-mode");
  await expect(page.getByText("Client-side time:")).not.toHaveText("Client-side time:");

  const increment = page.getByRole("button", { name: "+", exact: true });
  await increment.click();
  await expect(increment.locator("..").getByText("1", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Team (SSG)", exact: true }).click();
  await expect(page).toHaveURL(/\/team$/);
  await expect(page.getByRole("heading", { name: "Our Team", level: 1 })).toBeVisible();

  const apiDemoResponse = await page.goto("/api-demo");
  expect(apiDemoResponse?.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "API Demo", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Get admins only" }).click();
  const usersResult = page.getByRole("heading", { name: "GET /api/users", level: 2 }).locator("..");
  await expect(usersResult).toContainText("Alice Johnson");
  await expect(usersResult).not.toContainText("Bob Smith");

  const missingResponse = await page.goto("/missing-production-route");
  expect(missingResponse?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Oops! Page Not Found", level: 1 })).toBeVisible();
  await expect(page.getByText("/missing-production-route", { exact: true })).toBeVisible();
});

test("runs API handlers from the emitted server", async ({ request }) => {
  const hello = await request.get("/api/hello?name=Production");

  expect(hello.ok()).toBe(true);
  await expect(hello.json()).resolves.toMatchObject({
    message: "Hello, Production!",
    method: "GET",
  });

  const users = await request.get("/api/users?role=user&limit=1");
  expect(users.ok()).toBe(true);
  await expect(users.json()).resolves.toMatchObject({
    total: 1,
    users: [{ id: 2, name: "Bob Smith", email: "bob@example.com", role: "user" }],
  });
});
