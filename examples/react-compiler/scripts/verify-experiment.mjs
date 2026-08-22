import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const port = Number(process.env.FARM_EXPERIMENT_PORT || 4327);
const origin = `http://127.0.0.1:${port}`;
const serverEntry = path.resolve(".farm/.output/server/index.mjs");
const compilerReportPath = path.resolve(".farm/react-compiler.json");
const screenshotPath =
  process.env.FARM_EXPERIMENT_SCREENSHOT || "/tmp/farm-react-aot-edge-lab.png";
const mobileScreenshotPath = screenshotPath.replace(/(\.[^.]+)?$/, "-mobile$1");

await access(serverEntry);
const compilerReport = JSON.parse(await readFile(compilerReportPath, "utf8"));

assert.equal(compilerReport.version, 1);
assert.ok(compilerReport.summary.compiled >= 1);
const compiledComponents = new Set(
  compilerReport.modules.flatMap((module) => module.compiled),
);
for (const component of [
  "CommonSyntaxCounter",
  "ControlledSyntax",
  "CalculatedBindingPanel",
  "FormBindingPanel",
  "LogicalBlockPanel",
  "TernaryBlockPanel",
  "AutomaticKeyedListExperiment",
  "DerivedCollectionExperiment",
  "InteractiveKeyedListExperiment",
  "ExplicitKeyedListExperiment",
  "StatefulListRow",
  "ComponentIslandExperiment",
  "ComposableBlockExperiment",
]) {
  assert.ok(compiledComponents.has(component), `${component} was not compiled`);
}

let serverOutput = "";
const server = spawn(process.execPath, [serverEntry], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(port),
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout.on("data", (chunk) => {
  serverOutput += chunk;
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk;
});

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Production server exited early.\n${serverOutput}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Production server did not start.\n${serverOutput}`);
}

async function assertText(page, selector, expected) {
  await page.waitForFunction(
    ({ target, value }) =>
      document.querySelector(target)?.textContent?.trim() === value,
    { target: selector, value: expected },
  );
  assert.equal((await page.locator(selector).textContent())?.trim(), expected);
}

async function readNumber(page, selector) {
  return Number((await page.locator(selector).textContent())?.trim());
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const directExecutions = {};

  for (const pathName of ["compiled", "react"]) {
    const root = `[data-path="${pathName}"]`;
    await assertText(page, `${root} [data-metric="state"]`, "0");
    directExecutions[pathName] = {
      initial: await readNumber(page, `${root} [data-metric="executions"]`),
    };
    await page.locator(`${root} [data-action="update"]`).click();
    await page.locator(`${root} [data-action="update"]`).click();
    await assertText(page, `${root} [data-metric="state"]`, "2");
    directExecutions[pathName].final = await readNumber(
      page,
      `${root} [data-metric="executions"]`,
    );
    directExecutions[pathName].added =
      directExecutions[pathName].final - directExecutions[pathName].initial;
  }
  assert.equal(directExecutions.compiled.added, 0);
  assert.equal(directExecutions.react.added, 2);
  await assertText(
    page,
    '[data-path="compiled"] .update-status',
    "DOM bindings patched",
  );

  const batchExecutions = {};

  for (const pathName of ["batch-compiled", "batch-react"]) {
    const root = `[data-experiment="${pathName}"]`;
    batchExecutions[pathName] = {
      initial: await readNumber(page, `${root} [data-metric="executions"]`),
    };
    await page.locator(`${root} [data-action="batch"]`).click();
    await assertText(page, `${root} [data-metric="count"]`, "2");
    await assertText(page, `${root} [data-metric="snapshot"]`, "0");
    batchExecutions[pathName].final = await readNumber(
      page,
      `${root} [data-metric="executions"]`,
    );
    batchExecutions[pathName].added =
      batchExecutions[pathName].final - batchExecutions[pathName].initial;
  }
  assert.equal(batchExecutions["batch-compiled"].added, 0);
  assert.equal(batchExecutions["batch-react"].added, 1);

  const multiple = '[data-experiment="multiple-bindings"]';
  const multipleInitialExecutions = await readNumber(
    page,
    `${multiple} [data-metric="executions"]`,
  );
  await page.locator(`${multiple} [data-action="increment"]`).click();
  await page.locator(`${multiple} [data-action="toggle"]`).click();
  await assertText(page, `${multiple} [data-metric="count"]`, "1");
  await assertText(page, `${multiple} [data-metric="status"]`, "active");
  const multipleFinalExecutions = await readNumber(
    page,
    `${multiple} [data-metric="executions"]`,
  );
  assert.equal(multipleFinalExecutions - multipleInitialExecutions, 0);
  assert.equal(await page.locator(`${multiple} input`).inputValue(), "value-1");
  assert.equal(await page.locator(multiple).getAttribute("data-count"), "1");
  assert(
    await page
      .locator(multiple)
      .evaluate((element) => element.classList.contains("edge-card--active")),
  );

  const common = '[data-experiment="common-syntax"]';
  const commonInitialExecutions = await readNumber(
    page,
    `${common} [data-metric="executions"]`,
  );
  await assertText(page, `${common} h3`, "Alpha counter");
  await assertText(page, `${common} [data-metric="count"]`, "2");
  await assertText(page, `${common} [data-metric="doubled"]`, "4");
  await assertText(page, '[data-metric="parent-commit"]', "Last parent commit: -1");

  await page.locator(`${common} [data-action="commit"]`).click();
  await assertText(page, `${common} h3`, "Beta counter");
  await assertText(page, `${common} [data-metric="count"]`, "3");
  await assertText(page, `${common} [data-metric="doubled"]`, "6");
  await assertText(page, '[data-metric="parent-commit"]', "Last parent commit: 4");
  assert.equal(await page.locator(common).getAttribute("data-count"), "3");
  assert.equal(await page.locator(common).getAttribute("data-status"), "active");
  assert.equal(
    await page.locator(`${common} [data-action="commit"]`).getAttribute("aria-pressed"),
    "true",
  );

  await page.locator(`${common} [data-action="commit"]`).click();
  await assertText(page, `${common} h3`, "Alpha counter");
  await assertText(page, `${common} [data-metric="count"]`, "4");
  await assertText(page, `${common} [data-metric="doubled"]`, "8");
  await assertText(page, '[data-metric="parent-commit"]', "Last parent commit: 6");
  const commonFinalExecutions = await readNumber(
    page,
    `${common} [data-metric="executions"]`,
  );
  assert.equal(commonFinalExecutions - commonInitialExecutions, 2);

  const controlled = '[data-experiment="controlled-syntax"]';
  const controlledInput = page.locator(`${controlled} [data-input="controlled"]`);
  const controlledInitialExecutions = await readNumber(
    page,
    `${controlled} [data-metric="executions"]`,
  );
  await assertText(page, `${controlled} label`, "Display name");
  await assertText(page, `${controlled} [data-metric="value"]`, "empty");
  await controlledInput.fill("abcd");
  await assertText(page, `${controlled} [data-metric="value"]`, "abcd");
  await assertText(page, `${controlled} [data-metric="length"]`, "4");

  await controlledInput.evaluate((input) => {
    input.focus();
    input.setSelectionRange(2, 2);
  });
  await page.keyboard.insertText("X");
  await assertText(page, `${controlled} [data-metric="value"]`, "abXcd");
  assert.deepEqual(
    await controlledInput.evaluate((input) => [input.selectionStart, input.selectionEnd]),
    [3, 3],
  );

  await controlledInput.evaluate((input) => {
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.value = "日本";
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: "日本",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
    input.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "日本" }),
    );
  });
  await assertText(page, `${controlled} [data-metric="value"]`, "日本");
  await assertText(page, `${controlled} [data-metric="length"]`, "2");
  const controlledFinalExecutions = await readNumber(
    page,
    `${controlled} [data-metric="executions"]`,
  );
  assert.equal(controlledFinalExecutions - controlledInitialExecutions, 0);

  const calculated = '[data-experiment="calculated-bindings"]';
  const calculatedInitialExecutions = await readNumber(
    page,
    `${calculated} [data-metric="executions"]`,
  );
  await assertText(page, `${calculated} [data-metric="value"]`, "2");
  await assertText(page, `${calculated} [data-metric="percent"]`, "17%");
  assert.equal(await page.locator(calculated).getAttribute("data-percent"), "17");
  assert.equal(await page.locator(calculated).evaluate((element) => element.style.opacity), "1");
  assert.equal(
    await page.locator(`${calculated} .binding-meter__fill`).evaluate((element) => element.style.width),
    "17%",
  );

  await page.locator(`${calculated} [data-action="advance"]`).click();
  await assertText(page, `${calculated} [data-metric="value"]`, "4");
  await assertText(page, `${calculated} [data-metric="percent"]`, "33%");
  assert.equal(await page.locator(calculated).evaluate((element) => element.style.opacity), "0.58");
  assert.equal(
    await page.locator(`${calculated} .binding-meter__fill`).evaluate((element) => element.style.width),
    "33%",
  );

  await page.locator(`${calculated} [data-action="advance"]`).click();
  await assertText(page, `${calculated} [data-metric="value"]`, "6");
  await assertText(page, `${calculated} [data-metric="percent"]`, "50%");
  assert.equal(await page.locator(calculated).evaluate((element) => element.style.opacity), "1");
  const calculatedFinalExecutions = await readNumber(
    page,
    `${calculated} [data-metric="executions"]`,
  );
  assert.equal(calculatedFinalExecutions - calculatedInitialExecutions, 0);

  const form = '[data-experiment="form-bindings"]';
  const formInitialExecutions = await readNumber(page, `${form} [data-metric="executions"]`);
  const note = page.locator(`${form} [data-input="note"]`);
  await assertText(page, `${form} [data-metric="length"]`, "4");
  await assertText(page, `${form} [data-metric="mode"]`, "balanced");
  await assertText(page, `${form} [data-metric="summary"]`, "Farm / on");

  await note.fill("Compiler");
  await note.evaluate((element) => {
    element.focus();
    element.setSelectionRange(3, 3);
  });
  await page.keyboard.insertText("X");
  await assertText(page, `${form} [data-metric="length"]`, "9");
  assert.equal(await note.inputValue(), "ComXpiler");
  assert.deepEqual(await note.evaluate((element) => [element.selectionStart, element.selectionEnd]), [
    4,
    4,
  ]);

  await page.locator(`${form} [data-input="mode"]`).selectOption("fast");
  await page.locator(`${form} input[type="checkbox"]`).uncheck();
  await assertText(page, `${form} [data-metric="mode"]`, "fast");
  await assertText(page, `${form} [data-metric="summary"]`, "ComXpiler / off");
  assert.equal(await page.locator(form).getAttribute("data-enabled"), "false");
  const formFinalExecutions = await readNumber(page, `${form} [data-metric="executions"]`);
  assert.equal(formFinalExecutions - formInitialExecutions, 0);

  const logical = '[data-experiment="conditional-logical"]';
  const logicalInitialExecutions = await readNumber(
    page,
    `${logical} [data-metric="executions"]`,
  );
  await assertText(page, `${logical} [data-metric="mounted"]`, "no");
  assert.equal(
    await page.locator(`${logical} [data-branch="loading"]`).count(),
    0,
  );
  await page.locator(`${logical} [data-action="toggle-logical"]`).click();
  await assertText(page, `${logical} [data-metric="mounted"]`, "yes");
  await assertText(
    page,
    `${logical} [data-branch="loading"]`,
    "Loading branch · update 0",
  );
  await page.evaluate(() => {
    window.__farmLogicalBranch = document.querySelector(
      '[data-experiment="conditional-logical"] [data-branch="loading"]',
    );
  });
  await page.locator(`${logical} [data-action="increment-logical"]`).click();
  await assertText(page, `${logical} [data-metric="updates"]`, "1");
  await assertText(
    page,
    `${logical} [data-branch="loading"]`,
    "Loading branch · update 1",
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmLogicalBranch ===
        document.querySelector(
          '[data-experiment="conditional-logical"] [data-branch="loading"]',
        ),
    ),
    true,
    "compiler-owned conditional replaced a stable branch while patching its text",
  );
  await page.locator(`${logical} [data-action="toggle-logical"]`).click();
  await assertText(page, `${logical} [data-metric="mounted"]`, "no");
  assert.equal(
    await page.locator(`${logical} [data-branch="loading"]`).count(),
    0,
  );
  const logicalFinalExecutions = await readNumber(
    page,
    `${logical} [data-metric="executions"]`,
  );
  assert.equal(logicalFinalExecutions - logicalInitialExecutions, 0);

  const ternary = '[data-experiment="conditional-ternary"]';
  const ternaryInitialExecutions = await readNumber(
    page,
    `${ternary} [data-metric="executions"]`,
  );
  await assertText(page, `${ternary} [data-metric="branch"]`, "on");
  await assertText(page, `${ternary} [data-branch="enabled"]`, "Enabled");
  assert.equal(
    await page
      .locator(`${ternary} [data-branch="enabled"]`)
      .evaluate((node) => node.tagName),
    "STRONG",
  );
  await page.locator(`${ternary} [data-action="toggle-ternary"]`).click();
  await assertText(page, `${ternary} [data-metric="branch"]`, "off");
  await assertText(page, `${ternary} [data-branch="disabled"]`, "Disabled");
  assert.equal(
    await page
      .locator(`${ternary} [data-branch="disabled"]`)
      .evaluate((node) => node.tagName),
    "SPAN",
  );
  await page.locator(`${ternary} [data-action="toggle-ternary"]`).click();
  await assertText(page, `${ternary} [data-metric="branch"]`, "on");
  await assertText(page, `${ternary} [data-branch="enabled"]`, "Enabled");
  const ternaryFinalExecutions = await readNumber(
    page,
    `${ternary} [data-metric="executions"]`,
  );
  assert.equal(ternaryFinalExecutions - ternaryInitialExecutions, 0);

  const automaticList = '[data-experiment="keyed-automatic"]';
  const automaticListInitialExecutions = await readNumber(
    page,
    `${automaticList} [data-metric="executions"]`,
  );
  await page.evaluate(() => {
    const list = document.querySelector('[data-experiment="keyed-automatic"] [data-list="keyed"]');
    window.__farmAutomaticAlpha = document.querySelector(
      '[data-experiment="keyed-automatic"] [data-key="a"]',
    );
    window.__farmAutomaticBeta = document.querySelector(
      '[data-experiment="keyed-automatic"] [data-key="b"]',
    );
    window.__farmAutomaticMoves = 0;
    const insertBefore = list.insertBefore.bind(list);
    list.insertBefore = (node, anchor) => {
      if (node.parentNode === list) window.__farmAutomaticMoves += 1;
      return insertBefore(node, anchor);
    };
  });
  await page.locator(`${automaticList} [data-action="add-item"]`).click();
  await page.locator(`${automaticList} [data-action="add-item"]`).click();
  await assertText(page, `${automaticList} [data-metric="items"]`, "4");
  await page.locator(`${automaticList} [data-action="reverse-items"]`).click();
  await assertText(page, `${automaticList} [data-metric="first"]`, "Item 4");
  const automaticListFinalExecutions = await readNumber(
    page,
    `${automaticList} [data-metric="executions"]`,
  );
  assert.equal(automaticListFinalExecutions - automaticListInitialExecutions, 0);
  assert.deepEqual(await page.locator(`${automaticList} li`).allTextContents(), [
    "Item 4",
    "Item 3",
    "Beta",
    "Alpha",
  ]);
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmAutomaticAlpha ===
          document.querySelector('[data-experiment="keyed-automatic"] [data-key="a"]') &&
        window.__farmAutomaticBeta ===
          document.querySelector('[data-experiment="keyed-automatic"] [data-key="b"]'),
    ),
    true,
    "compiled keyed rows did not preserve surviving DOM identities",
  );
  assert.equal(
    await page.evaluate(() => window.__farmAutomaticMoves),
    3,
    "reversing four keyed rows should move only the three rows outside the LIS",
  );

  const derivedCollection = '[data-experiment="derived-collection"]';
  const derivedCollectionInitialExecutions = await readNumber(
    page,
    `${derivedCollection} [data-metric="executions"]`,
  );
  assert.deepEqual(
    await page.locator(`${derivedCollection} li`).allTextContents(),
    ["Delta", "Alpha", "Beta"],
  );
  await page.evaluate(() => {
    window.__farmDerivedAlpha = document.querySelector(
      '[data-experiment="derived-collection"] [data-key="a"]',
    );
  });
  await page.locator(`${derivedCollection} [data-action="filter-items"]`).click();
  await assertText(page, `${derivedCollection} [data-metric="minimum-rank"]`, "2");
  assert.deepEqual(await page.locator(`${derivedCollection} li`).allTextContents(), [
    "Delta",
    "Alpha",
  ]);
  await page.locator(`${derivedCollection} [data-action="sort-items"]`).click();
  await assertText(page, `${derivedCollection} [data-metric="direction"]`, "descending");
  assert.deepEqual(await page.locator(`${derivedCollection} li`).allTextContents(), [
    "Alpha",
    "Delta",
  ]);
  await page.locator(`${derivedCollection} [data-action="update-derived-row"]`).click();
  assert.deepEqual(await page.locator(`${derivedCollection} li`).allTextContents(), [
    "Delta",
    "Axiom",
  ]);
  await page.locator(`${derivedCollection} [data-action="filter-items"]`).click();
  await page.locator(`${derivedCollection} [data-action="resize-page"]`).click();
  assert.deepEqual(await page.locator(`${derivedCollection} li`).allTextContents(), [
    "Delta",
    "Axiom",
  ]);
  await page.locator(`${derivedCollection} [data-action="resize-page"]`).click();
  const derivedCollectionOrder = await page.locator(`${derivedCollection} li`).allTextContents();
  assert.deepEqual(derivedCollectionOrder, [
    "Beta",
    "Delta",
    "Axiom",
  ]);
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmDerivedAlpha ===
        document.querySelector('[data-experiment="derived-collection"] [data-key="a"]'),
    ),
    true,
    "the derived collection did not preserve a surviving keyed row",
  );
  await page.locator(`${derivedCollection} [data-action="stress-items"]`).click();
  const derivedStressRows = await page.locator(`${derivedCollection} li`).allTextContents();
  assert.deepEqual(derivedStressRows, ["Row 484", "Row 290", "Row 96"]);
  const derivedCollectionFinalExecutions = await readNumber(
    page,
    `${derivedCollection} [data-metric="executions"]`,
  );
  assert.equal(derivedCollectionFinalExecutions - derivedCollectionInitialExecutions, 0);

  const interactiveList = '[data-experiment="keyed-interactive"]';
  const interactiveListInitialExecutions = await readNumber(
    page,
    `${interactiveList} [data-metric="executions"]`,
  );
  await page.evaluate(() => {
    window.__farmInteractiveAlpha = document.querySelector(
      '[data-experiment="keyed-interactive"] [data-list="interactive"] [data-key="a"]',
    );
  });
  const interactiveAlpha = `${interactiveList} li[data-key="a"]`;
  await page.locator(`${interactiveAlpha} [data-action="toggle-interactive-row"]`).click();
  await assertText(page, `${interactiveAlpha} span`, "Alpha! · done");
  assert.equal(await page.locator(interactiveAlpha).getAttribute("data-done"), "true");
  await page.locator(`${interactiveAlpha} [data-action="toggle-interactive-row"]`).click();
  await assertText(page, `${interactiveAlpha} span`, "Alpha!! · open");
  assert.equal(await page.locator(interactiveAlpha).getAttribute("data-done"), "false");
  await assertText(page, `${interactiveList} [data-metric="captured"]`, "2");
  await page.locator(`${interactiveList} [data-action="reverse-interactive-rows"]`).click();
  await assertText(page, `${interactiveList} [data-metric="first"]`, "Gamma");
  assert.deepEqual(
    await page.locator(`${interactiveList} li > span`).allTextContents(),
    ["Gamma · open", "Beta · open", "Alpha!! · open"],
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmInteractiveAlpha ===
        document.querySelector(
          '[data-experiment="keyed-interactive"] [data-list="interactive"] [data-key="a"]',
        ),
    ),
    true,
    "React structural reconciliation did not preserve the interactive row identity",
  );
  await page.locator(`${interactiveAlpha} [data-action="toggle-interactive-row"]`).click();
  await assertText(page, `${interactiveAlpha} span`, "Alpha!!! · done");
  assert.equal(
    await page
      .locator(`${interactiveAlpha} [data-action="toggle-interactive-row"]`)
      .getAttribute("data-index"),
    "2",
  );
  await assertText(page, `${interactiveList} [data-metric="captured"]`, "3");
  const interactiveListFinalExecutions = await readNumber(
    page,
    `${interactiveList} [data-metric="executions"]`,
  );
  assert.equal(interactiveListFinalExecutions - interactiveListInitialExecutions, 0);

  const explicitList = '[data-experiment="keyed-explicit"]';
  const explicitListInitialExecutions = await readNumber(
    page,
    `${explicitList} [data-metric="executions"]`,
  );
  await page.locator(`${explicitList} [data-row="a"]`).click();
  await assertText(page, `${explicitList} [data-row="a"]`, "Alpha · 1");
  await page.locator(`${explicitList} [data-action="reverse-items"]`).click();
  await assertText(page, `${explicitList} [data-metric="first"]`, "Beta");
  assert.deepEqual(
    await page.locator(`${explicitList} [data-row]`).allTextContents(),
    ["Beta · 0", "Alpha · 1"],
  );
  const explicitListFinalExecutions = await readNumber(
    page,
    `${explicitList} [data-metric="executions"]`,
  );
  assert.equal(explicitListFinalExecutions - explicitListInitialExecutions, 0);

  const componentIslands = '[data-benchmark="component-islands"]';
  const islandOwnerInitialExecutions = await readNumber(
    page,
    `${componentIslands} [data-metric="island-owner-executions"]`,
  );
  const staticTreeInitialExecutions = Number(
    await page.locator(`${componentIslands} [data-static-executions]`).getAttribute(
      "data-static-executions",
    ),
  );
  await page.locator(`${componentIslands} [data-action="island-pin"]`).click();
  await assertText(
    page,
    `${componentIslands} [data-action="island-pin"]`,
    "Pinned",
  );
  for (let update = 0; update < 3; update += 1) {
    await page.locator(`${componentIslands} [data-action="island-update"]`).click();
  }
  await assertText(page, `${componentIslands} [data-metric="island-tick"]`, "3");
  await assertText(page, `${componentIslands} [data-island-tick]`, "3");
  await assertText(
    page,
    `${componentIslands} [data-action="island-pin"]`,
    "Pinned",
  );
  const islandOwnerFinalExecutions = await readNumber(
    page,
    `${componentIslands} [data-metric="island-owner-executions"]`,
  );
  const staticTreeFinalExecutions = Number(
    await page.locator(`${componentIslands} [data-static-executions]`).getAttribute(
      "data-static-executions",
    ),
  );
  assert.equal(islandOwnerFinalExecutions - islandOwnerInitialExecutions, 0);
  assert.equal(staticTreeFinalExecutions - staticTreeInitialExecutions, 0);

  const composable = '[data-experiment="composable-blocks"]';
  const composableOwnerInitialExecutions = await readNumber(
    page,
    `${composable} [data-metric="composable-owner-executions"]`,
  );
  await assertText(page, `${composable} [data-metric="composable-visible"]`, "shown");
  await assertText(page, `${composable} [data-metric="composable-primary-count"]`, "2");
  await assertText(page, `${composable} [data-metric="composable-secondary-count"]`, "1");
  await page.evaluate(() => {
    window.__farmComposableStatic = document.querySelector("[data-composable-static]");
    window.__farmComposableAlpha = document.querySelector('[data-composable-primary="a"]');
  });

  await page.locator(`${composable} [data-action="composable-pin"]`).click();
  await assertText(page, `${composable} [data-action="composable-pin"]`, "Pinned");
  await page.locator(`${composable} [data-action="composable-update"]`).click();
  await assertText(page, `${composable} [data-composable-count]`, "1");
  await assertText(page, `${composable} [data-metric="composable-secondary-count"]`, "2");
  assert.deepEqual(
    await page.locator(`${composable} [data-composable-primary]`).allTextContents(),
    ["Beta", "Alpha"],
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmComposableAlpha ===
        document.querySelector('[data-composable-primary="a"]'),
    ),
    true,
    "React did not preserve the keyed row DOM node during a reverse",
  );
  await assertText(page, `${composable} [data-action="composable-pin"]`, "Pinned");

  await page.locator(`${composable} [data-action="composable-details"]`).click();
  await assertText(page, `${composable} [data-composable-details]`, "Nested value 1");
  await assertText(page, `${composable} [data-composable-ready]`, "Nested host block ready");

  await page.locator(`${composable} [data-action="composable-hide-update"]`).click();
  await assertText(page, `${composable} [data-metric="composable-visible"]`, "hidden");
  assert.equal(await page.locator(`${composable} [data-composable-outer]`).count(), 0);
  await page.locator(`${composable} [data-action="composable-hidden-update"]`).click();
  await assertText(page, `${composable} [data-metric="composable-secondary-count"]`, "4");
  assert.equal(await page.locator(`${composable} [data-composable-outer]`).count(), 0);
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmComposableStatic === document.querySelector("[data-composable-static]"),
    ),
    true,
    "an unrelated static sibling was replaced",
  );

  await page.locator(`${composable} [data-action="composable-show"]`).click();
  await assertText(page, `${composable} [data-metric="composable-visible"]`, "shown");
  await assertText(page, `${composable} [data-composable-count]`, "3");
  await assertText(page, `${composable} [data-composable-details]`, "Nested value 3");
  await assertText(page, `${composable} [data-action="composable-pin"]`, "Pin child state");
  assert.deepEqual(
    await page.locator(`${composable} [data-composable-primary]`).allTextContents(),
    ["Beta", "Alpha"],
  );
  assert.equal(
    await page.locator(`${composable} [data-composable-secondary]`).count(),
    4,
  );
  const composableOwnerFinalExecutions = await readNumber(
    page,
    `${composable} [data-metric="composable-owner-executions"]`,
  );
  assert.equal(composableOwnerFinalExecutions - composableOwnerInitialExecutions, 0);

  await page.screenshot({ path: screenshotPath, fullPage: true });

  const mobilePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  mobilePage.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`[mobile] ${message.text()}`);
  });
  mobilePage.on("pageerror", (error) =>
    browserErrors.push(`[mobile] ${error.message}`),
  );
  await mobilePage.goto(origin, { waitUntil: "networkidle" });
  assert.equal(
    await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "the experiment page overflowed the mobile viewport",
  );
  await mobilePage
    .locator('[data-experiment="conditional-logical"] [data-action="toggle-logical"]')
    .click();
  await assertText(
    mobilePage,
    '[data-experiment="conditional-logical"] [data-branch="loading"]',
    "Loading branch · update 0",
  );
  await mobilePage.screenshot({ path: mobileScreenshotPath, fullPage: true });
  await mobilePage.close();
  assert.deepEqual(browserErrors, []);

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        productionUrl: origin,
        screenshots: {
          desktop: screenshotPath,
          mobile: mobileScreenshotPath,
        },
        compilerReport: path.relative(process.cwd(), compilerReportPath),
        compilerSummary: compilerReport.summary,
        experiments: {
          directUpdate: {
            compiled: {
              state: 2,
              updateExecutions: directExecutions.compiled.added,
            },
            react: { state: 2, updateExecutions: directExecutions.react.added },
          },
          batchedSnapshot: {
            compiled: {
              count: 2,
              snapshot: 0,
              updateExecutions: batchExecutions["batch-compiled"].added,
            },
            react: {
              count: 2,
              snapshot: 0,
              updateExecutions: batchExecutions["batch-react"].added,
            },
          },
          multipleBindings: {
            count: 1,
            status: "active",
            input: "value-1",
            updateExecutions:
              multipleFinalExecutions - multipleInitialExecutions,
          },
          commonSyntax: {
            count: 4,
            doubled: 8,
            parentCommit: 6,
            propDrivenExecutions:
              commonFinalExecutions - commonInitialExecutions,
          },
          controlledInput: {
            value: "日本",
            length: 2,
            updateExecutions:
              controlledFinalExecutions - controlledInitialExecutions,
            selectionPreserved: true,
            compositionObserved: true,
          },
          calculatedBindings: {
            value: 6,
            percent: 50,
            updateExecutions:
              calculatedFinalExecutions - calculatedInitialExecutions,
          },
          formBindings: {
            note: "ComXpiler",
            mode: "fast",
            enabled: false,
            selectionPreserved: true,
            updateExecutions: formFinalExecutions - formInitialExecutions,
          },
          conditionalLogicalBlock: {
            mounted: false,
            branchValue: 1,
            updateExecutions: logicalFinalExecutions - logicalInitialExecutions,
          },
          conditionalTernaryBlock: {
            branch: "enabled",
            updateExecutions: ternaryFinalExecutions - ternaryInitialExecutions,
          },
          automaticKeyedList: {
            items: 4,
            first: "Item 4",
            updateExecutions:
              automaticListFinalExecutions - automaticListInitialExecutions,
            keyedDomIdentityPreserved: true,
            lisMoves: 3,
            owner: "Farm keyed rows",
          },
          derivedCollection: {
            order: derivedCollectionOrder,
            stressSourceRows: 2048,
            stressMountedRows: derivedStressRows.length,
            updateExecutions:
              derivedCollectionFinalExecutions - derivedCollectionInitialExecutions,
            keyedDomIdentityPreserved: true,
            operations: ["filter", "toSorted", "slice", "toReversed"],
          },
          interactiveKeyedList: {
            alpha: "Alpha!!! · done",
            capturedClicks: 3,
            updateExecutions:
              interactiveListFinalExecutions - interactiveListInitialExecutions,
            keyedDomIdentityPreserved: true,
            structuralOwner: "React",
            bindingOwner: "Farm",
          },
          explicitKeyedList: {
            order: ["Beta", "Alpha"],
            alphaState: 1,
            updateExecutions:
              explicitListFinalExecutions - explicitListInitialExecutions,
            owner: "React",
          },
          componentIsland: {
            state: 3,
            childStatePreserved: true,
            ownerUpdateExecutions:
              islandOwnerFinalExecutions - islandOwnerInitialExecutions,
            staticSiblingUpdateExecutions:
              staticTreeFinalExecutions - staticTreeInitialExecutions,
          },
          composableBlocks: {
            count: 3,
            primaryOrder: ["Beta", "Alpha"],
            secondaryItems: 4,
            nestedConditional: "Nested value 3",
            keyedDomIdentityPreserved: true,
            childStateResetAfterOuterUnmount: true,
            ownerUpdateExecutions:
              composableOwnerFinalExecutions - composableOwnerInitialExecutions,
          },
        },
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill("SIGTERM");
}
