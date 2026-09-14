import { expect, test, type Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

async function openPanel(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Farm DevTools" }).click();
  const panel = page.frameLocator('iframe[title="Farm.js DevTools"]');
  await expect(panel.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  // Wait for the parent iframe's entrance animation, not an arbitrary delay.
  await expect(page.locator('iframe[title="Farm.js DevTools"]')).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)",
  );
  return panel;
}

test("DevTools launcher matches the Hints pill in both themes and on mobile", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "development");
  await page.goto("/");
  await page.getByRole("button", { name: "Collapse Farm Hints" }).click();
  const launcher = page.getByRole("button", { name: "Open Farm DevTools" });
  const hints = page.locator("farm-hints .launcher");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(launcher).toHaveCSS("border-radius", "999px");
      await expect(launcher).toHaveCSS("font-size", "11px");
      await expect(launcher).toHaveCSS("text-transform", "uppercase");
      // Chromium may serialize zero tracking as "normal". Compare the reference
      // control in the same browser instead of relying on that serialization.
      await expect(launcher).toHaveCSS(
        "letter-spacing",
        await page
          .locator("farm-hints .launcher-label")
          .evaluate((element) => getComputedStyle(element).letterSpacing),
      );
      for (const property of [
        "background-color",
        "color",
        "border-top-color",
        "box-shadow",
      ] as const) {
        await expect(launcher).toHaveCSS(
          property,
          await hints.evaluate(
            (element, key) => getComputedStyle(element).getPropertyValue(key),
            property,
          ),
        );
      }
      const label = launcher.locator("span");
      await expect(label).toHaveCSS(
        "font-family",
        await page
          .locator("farm-hints .launcher-label")
          .evaluate((element) => getComputedStyle(element).fontFamily),
      );
      const box = (await launcher.boundingBox())!;
      const hintBox = (await hints.boundingBox())!;
      expect(box.height).toBe(42);
      expect(box.y + box.height).toBeCloseTo(hintBox.y + hintBox.height);
      expect(box.x + box.width).toBeLessThan(hintBox.x);
      expect(
        await launcher.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth),
      ).toBeGreaterThan(0);
    }
  }
  // The pill must not eagerly download the inspector or highlighter.
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .some((entry) => /devtools\/assets\/panel\.(js|css)/.test(entry.name)),
    ),
  ).toBe(false);
  await launcher.focus();
  await expect(launcher).toHaveCSS("outline-style", "solid");
  await launcher.press("Enter");
  await expect(
    page
      .frameLocator('iframe[title="Farm.js DevTools"]')
      .getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
});

test("demo uses a plain background and readable hero sizing", async ({ page }) => {
  await page.goto("/");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator(".shell")).toHaveCSS("background-image", "none");
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible();
      await expect(heading).toHaveCSS("font-size", width === 1280 ? "44px" : "32px");
      expect(
        await heading.evaluate((element) => {
          const style = getComputedStyle(element);
          return parseFloat(style.lineHeight) > parseFloat(style.fontSize);
        }),
      ).toBe(true);
      await expect(page.locator(".intro")).toHaveCSS("font-size", "16px");
      if (colorScheme === "dark") {
        await expect(page.locator(".hero > .eyebrow")).toHaveCSS("color", "rgb(215, 142, 128)");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  // These are intentional findings, not styling defects to clean up in this demo.
  await expect(page.locator('[id="field-status"]')).toHaveCount(2);
  await expect(page.locator(".nested-control > a")).toHaveCount(1);
  await expect(page.locator(".preview-row img")).not.toHaveAttribute("height");
});

test("test case sits below the hero and stays clear of desktop Hints", async ({ page }, info) => {
  await page.goto("/");
  for (const width of [1280, 1024, 900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const hero = (await page.locator(".hero").boundingBox())!;
    const fixture = (await page
      .getByRole("region", { name: "Three things to inspect" })
      .boundingBox())!;
    const note = (await page.locator(".note").boundingBox())!;
    expect(fixture.y).toBeGreaterThanOrEqual(hero.y + hero.height + 24);
    expect(fixture.x).toBeCloseTo(hero.x);
    expect(fixture.width).toBeLessThanOrEqual(620);
    expect(note.y).toBeGreaterThanOrEqual(fixture.y + fixture.height + 24);
    if (info.project.name === "development" && width >= 900) {
      const hints = page.getByRole("region", { name: "Farm Hints", exact: true });
      await expect(hints).toBeVisible();
      const overlay = (await hints.boundingBox())!;
      expect(fixture.x + fixture.width).toBeLessThanOrEqual(overlay.x - 24);
      expect(hero.x + hero.width).toBeLessThanOrEqual(overlay.x - 24);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test("real routes, API metadata, highlighted transforms, and snapshot copying", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "development");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = await openPanel(page);
  const navIcons = await panel
    .locator(".fd-nav-button svg")
    .evaluateAll((elements) => elements.map((element) => element.innerHTML));
  expect(navIcons).toHaveLength(8);
  expect(navIcons.every((markup) => markup.length > 0)).toBe(true);
  expect(new Set(navIcons).size).toBe(8);
  await expect(panel.getByAltText("Farm.js logo")).toBeVisible();
  expect(
    await panel.getByAltText("Farm.js logo").evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await panel.getByRole("button", { name: /^Routes/ }).click();
  await expect(panel.getByRole("region", { name: "Selected route" })).toContainText("src/app/");
  await panel.getByRole("searchbox", { name: "Filter routes" }).fill("not-a-route");
  await expect(panel.getByText("No matches. Try another path, kind, or source.")).toBeVisible();
  await panel.getByRole("button", { name: /^API / }).click();
  await expect(panel.getByRole("region", { name: "Selected API" })).toContainText("/api/status");
  await expect(panel.getByRole("region", { name: "Selected API" })).toContainText("GET");
  await panel.getByRole("button", { name: "Inspect", exact: true }).click();
  const select = panel.getByRole("combobox", { name: "MODULE" });
  await expect(select).toBeEnabled();
  const counterId = await select
    .locator("option")
    .filter({ hasText: "src/app/counter.tsx" })
    .first()
    .getAttribute("value");
  expect(counterId).toMatch(/^[a-f0-9]{64}$/);
  await select.selectOption(counterId!);
  await expect(panel.getByRole("region", { name: "Source", exact: true })).toContainText(
    "useState",
  );
  await expect(panel.getByRole("region", { name: "Served JavaScript" })).toContainText("jsx");
  expect(await panel.locator(".sh__token--keyword").count()).toBeGreaterThan(0);
  await panel.getByRole("button", { name: "Copy Source", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "export function Counter()",
  );
  await panel.getByRole("button", { name: "Snapshot", exact: true }).click();
  await panel.getByRole("button", { name: "Copy Runtime JSON" }).click();
  const snapshot = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(snapshot.apiRoutes.some((route: { path: string }) => route.path === "/api/status")).toBe(
    true,
  );
  await panel.getByRole("button", { name: "Close DevTools" }).click();
  await expect(page.locator('iframe[title="Farm.js DevTools"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Farm DevTools" })).toBeFocused();
  await page.getByRole("button", { name: "Count: 0", exact: true }).click();
  await expect(page.getByRole("button", { name: "Count: 1", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("controls align icons and fill their hover targets, with Hints-style footer labels", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "development");
  const panel = await openPanel(page);
  const routes = panel.getByRole("button", { name: "View all routes", exact: true });
  // The old text-only hover strip was 24px high with no horizontal padding.
  expect((await routes.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await routes.hover({ position: { x: 3, y: 3 } });
    await expect(routes).toHaveCSS(
      "background-color",
      colorScheme === "light" ? "rgb(238, 238, 238)" : "rgb(38, 38, 38)",
    );
    await expect(routes).toHaveCSS("padding-left", "10px");
    const box = (await routes.boundingBox())!;
    await routes.hover({ position: { x: box.width - 3, y: box.height - 3 } });
    await expect(routes).toHaveCSS(
      "background-color",
      colorScheme === "light" ? "rgb(238, 238, 238)" : "rgb(38, 38, 38)",
    );
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const control of await panel.locator(".fd-nav-button, .fd-link-button").all()) {
      const glyph = (await control.locator("svg").boundingBox())!;
      const label = (await control.locator(".fd-button-label").boundingBox())!;
      expect(Math.abs(glyph.y + glyph.height / 2 - label.y - label.height / 2)).toBeLessThan(1);
    }
    for (const control of await panel.locator(".fd-icon-button").all()) {
      const box = (await control.boundingBox())!;
      const glyph = (await control.locator("svg").boundingBox())!;
      expect(box.width).toBe(box.height);
      expect(Math.abs(box.x + box.width / 2 - glyph.x - glyph.width / 2)).toBeLessThan(1);
      expect(Math.abs(box.y + box.height / 2 - glyph.y - glyph.height / 2)).toBeLessThan(1);
    }
    const footer = panel.locator(".fd-footer");
    for (const text of ["Development only", "Esc to close"]) {
      const label = footer.getByText(text, { exact: true });
      await expect(label).toBeVisible();
      await expect(label).toHaveCSS("text-transform", "uppercase");
      await expect(label).toHaveCSS("font-size", "8px");
      await expect(label).toHaveCSS("font-variation-settings", '"wght" 620');
    }
    await expect(footer.locator("[data-status]")).toContainText("Updated");
    expect(
      await panel.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth),
    ).toBe(true);
  }
  await routes.click();
  const copy = panel.getByRole("button", { name: "Copy source path" });
  expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  await copy.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(copy).toBeFocused();
  await expect(copy).toHaveCSS("outline-style", "solid");
});

test("themes, narrow viewport, keyboard dismissal, and recoverable refresh failures", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "development");
  await page.emulateMedia({ colorScheme: "light" });
  const panel = await openPanel(page);
  const themeToggle = panel.getByRole("button", { name: "Switch to dark theme", exact: true });
  await expect(panel.locator("#farm-devtools")).toHaveCSS("border-color", "rgb(212, 212, 212)");
  await expect(themeToggle.locator("svg path")).toHaveCount(1);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(panel.locator("#farm-devtools")).toHaveCSS("border-color", "rgb(64, 64, 64)");
  await expect(
    panel.getByRole("button", { name: "Switch to light theme" }).locator("svg circle"),
  ).toHaveCount(1);
  await page.emulateMedia({ colorScheme: "light" });
  await themeToggle.click();
  await expect(panel.locator("#farm-devtools")).toHaveAttribute("data-theme", "dark");
  await expect(panel.getByRole("button", { name: "Switch to light theme" })).toHaveAttribute(
    "title",
    "Switch to light theme",
  );
  await panel.getByRole("button", { name: "Close DevTools" }).click();
  await expect(page.locator('iframe[title="Farm.js DevTools"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Open Farm DevTools" }).click();
  await expect(
    panel.getByRole("button", { name: "Switch to light theme" }).locator("svg circle"),
  ).toHaveCount(1);
  await page.route("**/__farm/devtools.json", (route) => route.abort());
  await panel.getByRole("button", { name: "Refresh DevTools" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.getByText("Showing the last snapshot")).toBeVisible();
  await page.unroute("**/__farm/devtools.json");
  await panel.getByRole("button", { name: "Refresh DevTools" }).click();
  await expect(panel.getByRole("alert")).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole("button", { name: "Inspect", exact: true })).toBeVisible();
  expect(await panel.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(
    true,
  );
  await panel.getByRole("button", { name: "Close DevTools" }).press("Escape");
  await expect(page.locator('iframe[title="Farm.js DevTools"]')).toHaveCount(0);
});

for (const width of [1280, 390]) {
  test(`modal contains scrolling and restores the page at ${width}px`, async ({ page }, info) => {
    test.skip(info.project.name !== "development");
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const hints = page.getByRole("region", { name: "Farm Hints", exact: true });
    await expect(hints.locator(".brand-name")).toHaveText("FARM.JS");
    await expect(hints.locator(".brand strong")).toHaveText("Hints");
    await expect(hints.locator(".brand-logo")).toHaveCSS("width", "16px");
    await expect(hints.locator(".brand-logo")).toHaveCSS("height", "16px");
    await expect(hints.locator(".brand-name")).toHaveCSS("font-size", "12px");
    await expect(hints.locator(".brand strong")).toHaveCSS("font-size", "11px");
    const brandBox = await hints.locator(".brand").boundingBox();
    const actionsBox = await hints.locator(".header-actions").boundingBox();
    expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(actionsBox!.x);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(hints).toHaveCSS(
        "background-color",
        colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(16, 16, 16)",
      );
    }
    // The demo also opens Hints, whose narrow-screen panel covers the launcher.
    await page.getByRole("button", { name: "Collapse Farm Hints" }).click();
    await page.evaluate(() => {
      document.body.style.minHeight = "3000px";
      document.documentElement.style.setProperty("overflow-y", "scroll", "important");
      window.scrollTo(0, 200);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
    await page.getByRole("button", { name: "Open Farm DevTools" }).click();
    const frame = page.locator('iframe[title="Farm.js DevTools"]');
    const panel = page.frameLocator('iframe[title="Farm.js DevTools"]');
    await expect(frame).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await expect(page.getByRole("dialog", { name: "Farm.js DevTools overlay" })).toHaveCSS(
      "backdrop-filter",
      "blur(6px)",
    );
    await expect(frame).toHaveCSS("width", width === 1280 ? "1100px" : "374px");
    await expect(frame).toHaveCSS("height", width === 1280 ? "720px" : "828px");
    await expect(frame).toHaveCSS("border-radius", "12px");
    await expect(panel.locator("#farm-devtools")).toHaveCSS("border-radius", "12px");
    await expect(panel.getByAltText("Farm.js logo")).toHaveCSS("width", "16px");
    await expect(panel.getByAltText("Farm.js logo")).toHaveCSS("height", "16px");
    await expect(panel.locator(".fd-brand")).toHaveCSS("font-size", "12px");
    await expect(panel.locator(".fd-header")).toHaveCSS("font-size", "11px");
    for (const side of ["top", "right", "bottom", "left"]) {
      await expect(panel.locator("#farm-devtools")).toHaveCSS(
        `border-${side}`,
        "1px solid rgb(64, 64, 64)",
      );
    }
    await panel.getByRole("button", { name: "Snapshot", exact: true }).click();
    const main = panel.getByRole("main");
    await expect(main).toContainText("generatedAt");
    await main.hover({ position: { x: 50, y: 100 } });
    await page.mouse.wheel(0, 450);
    await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(200);
    await main.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.mouse.wheel(0, 600);
    await page.mouse.move(3, 3);
    await page.mouse.wheel(0, 600);
    expect(await page.evaluate(() => window.scrollY)).toBe(200);
    await panel.getByRole("button", { name: "Close DevTools" }).click();
    await expect(frame).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(200);
    expect(
      await page.evaluate(() => document.documentElement.style.getPropertyPriority("overflow-y")),
    ).toBe("important");
    await page.mouse.move(width / 2, 700);
    await page.mouse.wheel(0, 450);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    // Click-through space must not disable the Hints launcher or its panel controls.
    await page.getByRole("button", { name: "Open Farm Hints" }).click();
    await page.getByRole("button", { name: "Collapse Farm Hints" }).click();
  });
}

test("development endpoints enforce the request boundary", async ({ request }, info) => {
  test.skip(info.project.name !== "development");
  const path = "/__farm/devtools/modules.json";
  expect(
    (await request.get(path, { headers: { origin: "https://untrusted.example" } })).status(),
  ).toBe(403);
  expect((await request.get(path, { headers: { host: "untrusted.example" } })).status()).toBe(403);
  expect((await request.post(path)).status()).toBe(405);
  expect((await request.get("/__farm/devtools/module.json?id=../../.env")).status()).toBe(404);
  const response = await request.get(path);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.status()).toBe(200);
});

test("production has no launcher, inspector endpoints, or UI assets", async ({
  page,
  request,
}, info) => {
  test.skip(info.project.name !== "production");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Farm DevTools" })).toHaveCount(0);
  expect(await page.evaluate(() => "__FARM_DEVTOOLS__" in window)).toBe(false);
  for (const path of [
    "/__farm/devtools?embedded=1",
    "/__farm/devtools.json",
    "/__farm/devtools/modules.json",
    "/__farm/devtools/assets/panel.js",
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  const scripts = await page
    .locator("script[src]")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLScriptElement).src));
  for (const url of scripts)
    expect(await (await request.get(url)).text()).not.toContain("farm-devtools-launcher");
  const output = path.resolve("examples/hints-demo/.farm/client");
  for (const file of await readdir(output, { recursive: true })) {
    if (/\.(js|css)$/.test(file)) {
      const source = await readFile(path.join(output, file), "utf8");
      expect(source, file).not.toMatch(/farm-devtools|__FARM_DEVTOOLS__|--sh-keyword/);
    }
  }
});
