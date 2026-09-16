import { expect, test } from "@playwright/test";

// Islands rendered inside table, select, and svg take the route-wide fallback:
// a boundary marker placed there is relocated or ignored by the HTML parser
// before any script runs. These assert the markup the parser actually keeps and
// that the widgets still work, which is what the fallback buys.

async function boundaryMarkersInside(page: import("@playwright/test").Page, selector: string) {
  return page.locator(`${selector} farm-client-boundary`).count();
}

test("an island in table context keeps the row in the table and stays interactive", async ({
  page,
}) => {
  await page.goto("/table");

  const row = page.getByTestId("table-row");
  await expect(row).toHaveCount(1);
  // Foster parenting would move the row out of the table entirely.
  expect(
    await page.evaluate(
      () => !!document.querySelector('[data-testid="table-row"]')?.closest("table"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.querySelector('[data-testid="table-row"]')?.parentElement?.tagName,
    ),
  ).toBe("TBODY");
  expect(await boundaryMarkersInside(page, '[data-testid="table"]')).toBe(0);

  // Exactly one button: the pre-fix marker left a hydrated duplicate behind.
  const button = page.getByTestId("table-button");
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(button).toHaveText("row selected");
});

test("an island in select context keeps options as direct children", async ({ page }) => {
  await page.goto("/select");

  const childTags = await page.evaluate(() =>
    Array.from(document.querySelector('[data-testid="select"]')?.children ?? []).map(
      (child) => child.tagName,
    ),
  );
  expect(childTags.every((tag) => tag === "OPTION")).toBe(true);
  expect(childTags.length).toBeGreaterThan(0);
  expect(await boundaryMarkersInside(page, '[data-testid="select"]')).toBe(0);
});

test("an island in svg context renders in the svg namespace and stays interactive", async ({
  page,
}) => {
  await page.goto("/svg");

  const circle = page.getByTestId("svg-circle");
  await expect(circle).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.querySelector('[data-testid="svg-circle"]')?.parentElement?.tagName,
    ),
  ).toBe("svg");
  expect(await boundaryMarkersInside(page, '[data-testid="svg"]')).toBe(0);

  // An unknown element in the SVG namespace would leave the circle unrendered
  // and therefore not actionable.
  await circle.click();
  await expect(circle).toHaveAttribute("r", "40");
});

test("the layout islands still isolate on a route that fell back", async ({ page }) => {
  await page.goto("/table");
  // The fallback is scoped to the page that renders into a parser-sensitive
  // container; the layout's own islands keep their markers.
  await expect(page.locator("header farm-client-boundary")).toHaveCount(2);
  const counter = page.getByTestId("counter");
  await counter.click();
  await expect(counter).toHaveText("count: 1");
});
