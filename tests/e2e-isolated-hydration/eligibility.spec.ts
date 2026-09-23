import { expect, test } from "@playwright/test";

// Eligibility cases that must degrade to route-wide hydration rather than
// producing a widget that looks interactive and is not.

test("a boundary handed server-rendered children stays interactive", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/children");

  // Props cross the boundary as JSON, so an element child cannot be isolated:
  // this page takes the route-wide fallback and emits no marker of its own.
  await expect(page.locator('[data-testid="shell"] farm-client-boundary')).toHaveCount(0);
  await expect(page.getByTestId("server-child")).toHaveText("server-rendered child: 3 items");

  // Without the fallback the marker is dropped, nothing hydrates the shell,
  // and this click does nothing at all.
  const toggle = page.getByTestId("shell-toggle");
  await expect(toggle).toHaveText("shell closed");
  await toggle.click();
  await expect(toggle).toHaveText("shell open");
  await expect(page.getByTestId("shell")).toHaveAttribute("data-open", "yes");

  expect(consoleErrors).toEqual([]);
});

test("a client island inside a route slot hydrates in the slot's own root", async ({ page }) => {
  await page.goto("/slots");

  await expect(page.getByTestId("panel-slot")).toBeVisible();
  // Slots hydrate route-wide inside their own root, so the island renders
  // without a boundary marker rather than being claimed by the page runtime.
  await expect(page.locator('[data-testid="slot-host"] farm-client-boundary')).toHaveCount(0);

  const slotCounter = page.locator('[data-testid="panel-slot"] [data-testid="counter"]');
  await expect(slotCounter).toHaveText("count: 100");
  await slotCounter.click();
  await expect(slotCounter).toHaveText("count: 101");
});

test("layout islands keep isolating on routes that fell back", async ({ page }) => {
  for (const route of ["/children", "/slots"]) {
    await page.goto(route);
    // The fallback is scoped to the page that needs it; the layout's own
    // islands still hydrate as independent roots.
    await expect(page.locator("header farm-client-boundary")).toHaveCount(2);
    const counter = page.locator("header").getByTestId("counter");
    await expect(counter).toHaveText("count: 0");
    await counter.click();
    await expect(counter).toHaveText("count: 1");
  }
});
