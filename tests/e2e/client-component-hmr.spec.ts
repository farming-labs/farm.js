import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.FARM_E2E_MODE === "prod", "Development HMR");

const fixture = path.resolve("examples/basic/src/app/hmr-e2e");
const heading = "Client component HMR";

async function openFixture(page: Page) {
  await page.goto("/hmr-e2e");
  await page.waitForFunction(() =>
    window.__FARM_CLIENT_PLUGIN_EVENTS__?.some((event) => event.startsWith("hydration:after:")),
  );
  // A full reload drops this marker, so its presence proves the update was applied in place.
  await page.evaluate(() => {
    (window as Window & { __farmHmrMarker__?: boolean }).__farmHmrMarker__ = true;
  });
}

function stillSamePage(page: Page) {
  return page.evaluate(
    () => (window as Window & { __farmHmrMarker__?: boolean }).__farmHmrMarker__ === true,
  );
}

async function editSource(file: string, from: string, to: string) {
  const original = await readFile(file, "utf8");
  if (!original.includes(from)) throw new Error(`${file} does not contain ${from}`);
  await writeFile(file, original.replace(from, to));
  return async () => {
    if ((await readFile(file, "utf8")) !== original) await writeFile(file, original);
  };
}

for (const { name, file, testId } of [
  { name: "named", file: "named-export-counter.tsx", testId: "named-export" },
  { name: "default", file: "default-export-counter.tsx", testId: "default-export" },
]) {
  test(`editing a ${name}-export client component updates it in place`, async ({ page }) => {
    await openFixture(page);
    const counter = page.getByTestId(testId);
    await counter.click();
    await counter.click();
    await expect(counter).toHaveText(`${name} export 2`);

    const restore = await editSource(
      path.join(fixture, file),
      `${name} export {count}`,
      `${name} export edited {count}`,
    );
    try {
      // Fast Refresh swaps the component and keeps its state.
      await expect(counter).toHaveText(`${name} export edited 2`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page.getByTestId("named-export")).toBeVisible();
      await expect(page.getByTestId("default-export")).toBeVisible();
      expect(await stillSamePage(page)).toBe(true);
    } finally {
      await restore();
    }
    await expect(counter).toHaveText(`${name} export 2`);
  });
}

test("editing the page module still updates the page", async ({ page }) => {
  await openFixture(page);
  const restore = await editSource(path.join(fixture, "page.tsx"), heading, `${heading} edited`);
  try {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${heading} edited`);
    await expect(page.getByTestId("named-export")).toHaveText("named export 0");
    await expect(page.getByTestId("default-export")).toHaveText("default export 0");
  } finally {
    await restore();
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
});
