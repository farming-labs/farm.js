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
const browserExecutablePath = process.env.FARM_EXPERIMENT_BROWSER_PATH;

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
  "ConditionalRangePanel",
  "AutomaticKeyedListExperiment",
  "DerivedCollectionExperiment",
  "InteractiveKeyedListExperiment",
  "EditableKeyedListExperiment",
  "RowConditionalListExperiment",
  "ExplicitKeyedListExperiment",
  "KeyedRangeExperiment",
  "StatefulListRow",
  "ComponentIslandExperiment",
  "ComposableBlockExperiment",
  "KeyedRowHostBlockExperiment",
  "NestedKeyedRowExperiment",
  "RecursiveKeyedScopeExperiment",
  "MixedRangeExperiment",
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
  browser = await chromium.launch({
    headless: true,
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
  });
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

  const conditionalRanges = '[data-experiment="conditional-ranges"]';
  const conditionalRangesInitialExecutions = await readNumber(
    page,
    `${conditionalRanges} [data-metric="range-executions"]`,
  );
  await page.evaluate(() => {
    const root = document.querySelector('[data-experiment="conditional-ranges"]');
    window.__farmConditionalRangeRoot = root;
    window.__farmConditionalRangeHeader = root.querySelector('[data-static="range-header"]');
    window.__farmConditionalRangeContent = root.querySelector('[data-static="range-content"]');
    window.__farmConditionalRangeMetrics = root.querySelector('[data-static="range-metrics"]');
    window.__farmConditionalRangeFooter = root.querySelector('[data-static="range-footer"]');
    window.__farmConditionalRangeStatus = root.querySelector('[data-slot="range-status"]');
  });
  await assertText(page, `${conditionalRanges} [data-slot="range-status"]`, "Enabled at 0");
  assert.equal(await page.locator(`${conditionalRanges} [data-slot="range-loading"]`).count(), 0);

  await page.locator(`${conditionalRanges} [data-action="increment-ranges"]`).click();
  await assertText(page, `${conditionalRanges} [data-slot="range-status"]`, "Enabled at 1");
  await assertText(page, `${conditionalRanges} [data-metric="range-updates"]`, "Update 1");
  assert.equal(await page.locator(conditionalRanges).getAttribute("data-update"), "1");
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmConditionalRangeStatus ===
        document.querySelector('[data-experiment="conditional-ranges"] [data-slot="range-status"]'),
    ),
    true,
    "a same-branch conditional range lost its DOM identity",
  );

  await page.locator(`${conditionalRanges} [data-action="toggle-ranges"]`).click();
  await assertText(page, `${conditionalRanges} [data-slot="range-loading"]`, "Loading update 1");
  await assertText(page, `${conditionalRanges} [data-slot="range-status"]`, "Disabled at 1");
  assert.deepEqual(
    await page.locator(conditionalRanges).evaluate((root) =>
      [...root.children].map(
        (child) => child.getAttribute("data-static") || child.getAttribute("data-slot"),
      ),
    ),
    [
      "range-header",
      "range-loading",
      "range-content",
      "range-status",
      "range-metrics",
      "range-footer",
    ],
  );

  await page.locator(`${conditionalRanges} [data-action="toggle-ranges"]`).click();
  await assertText(page, `${conditionalRanges} [data-slot="range-status"]`, "Enabled at 1");
  assert.equal(await page.locator(`${conditionalRanges} [data-slot="range-loading"]`).count(), 0);
  const conditionalRangesIdentity = await page.evaluate(() => {
    const root = document.querySelector('[data-experiment="conditional-ranges"]');
    return {
      root: window.__farmConditionalRangeRoot === root,
      header:
        window.__farmConditionalRangeHeader === root.querySelector('[data-static="range-header"]'),
      content:
        window.__farmConditionalRangeContent === root.querySelector('[data-static="range-content"]'),
      metrics:
        window.__farmConditionalRangeMetrics === root.querySelector('[data-static="range-metrics"]'),
      footer:
        window.__farmConditionalRangeFooter === root.querySelector('[data-static="range-footer"]'),
    };
  });
  assert.deepEqual(conditionalRangesIdentity, {
    root: true,
    header: true,
    content: true,
    metrics: true,
    footer: true,
  });
  const conditionalRangesFinalExecutions = await readNumber(
    page,
    `${conditionalRanges} [data-metric="range-executions"]`,
  );
  assert.equal(conditionalRangesFinalExecutions - conditionalRangesInitialExecutions, 0);

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

  const editableList = '[data-experiment="keyed-editable"]';
  const editableListInitialExecutions = await readNumber(
    page,
    `${editableList} [data-metric="executions"]`,
  );
  const editableAlpha = `${editableList} [data-key="a"]`;
  const editableAlphaName = page.locator(`${editableAlpha} [data-control="name"]`);
  await page.evaluate(() => {
    window.__farmEditableAlpha = document.querySelector(
      '[data-experiment="keyed-editable"] [data-key="a"]',
    );
    window.__farmEditableAlphaName = document.querySelector(
      '[data-experiment="keyed-editable"] [data-key="a"] [data-control="name"]',
    );
  });
  await editableAlphaName.evaluate((input) => {
    input.focus();
    input.setSelectionRange(8, 8);
  });
  await page.keyboard.insertText("X");
  assert.equal(await editableAlphaName.inputValue(), "CompilerX graph");
  assert.deepEqual(
    await editableAlphaName.evaluate((input) => [input.selectionStart, input.selectionEnd]),
    [9, 9],
  );
  await page.locator(`${editableAlpha} [data-control="priority"]`).selectOption("low");
  await page.locator(`${editableAlpha} [data-control="done"]`).check();
  await assertText(page, `${editableList} [data-metric="edits"]`, "3");
  await assertText(
    page,
    `${editableAlpha} [data-row-output="a"]`,
    "ROW 1 · CompilerX graph · low · done",
  );
  await editableAlphaName.evaluate((input) => {
    input.focus();
    input.setSelectionRange(2, 6);
  });
  await page
    .locator(`${editableList} [data-action="rotate-editable-rows"]`)
    .evaluate((button) => button.click());
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-experiment="keyed-editable"] [data-list="editable"] > li')]
        .map((row) => row.getAttribute("data-key"))
        .join(",") === "c,a,b",
  );
  assert.deepEqual(
    await page
      .locator(`${editableList} [data-list="editable"] > li`)
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-key"))),
    ["c", "a", "b"],
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmEditableAlpha ===
          document.querySelector('[data-experiment="keyed-editable"] [data-key="a"]') &&
        window.__farmEditableAlphaName ===
          document.querySelector(
            '[data-experiment="keyed-editable"] [data-key="a"] [data-control="name"]',
          ),
    ),
    true,
    "React did not preserve the editable keyed row and input through the reorder",
  );
  assert.deepEqual(
    await editableAlphaName.evaluate((input) => [
      document.activeElement === input,
      input.selectionStart,
      input.selectionEnd,
    ]),
    [true, 2, 6],
  );
  await assertText(
    page,
    `${editableAlpha} [data-row-output="a"]`,
    "ROW 2 · CompilerX graph · low · done",
  );
  const editableListAfterInteractions = await readNumber(
    page,
    `${editableList} [data-metric="executions"]`,
  );
  assert.equal(editableListAfterInteractions - editableListInitialExecutions, 0);
  await page.locator(`${editableList} [data-action="load-editable-rows"]`).click();
  await assertText(page, `${editableList} [data-metric="rows"]`, "256");
  assert.equal(await page.locator(`${editableList} [data-list="editable"] > li`).count(), 256);
  const editableListFinalExecutions = await readNumber(
    page,
    `${editableList} [data-metric="executions"]`,
  );
  assert.equal(editableListFinalExecutions - editableListInitialExecutions, 0);

  const keyedRanges = '[data-experiment="keyed-ranges"]';
  const keyedRangesList = `${keyedRanges}[data-list="ranges"]`;
  const keyedRangesInitialExecutions = await readNumber(
    page,
    `${keyedRanges} [data-metric="executions"]`,
  );
  await page.evaluate(() => {
    const list = document.querySelector('[data-experiment="keyed-ranges"][data-list="ranges"]');
    window.__farmRangeRoot = list;
    window.__farmRangeHeader = list.querySelector('[data-static="range-header"]');
    window.__farmRangeDivider = list.querySelector('[data-static="range-divider"]');
    window.__farmRangeFooter = list.querySelector('[data-static="range-footer"]');
    window.__farmRangeA = list.querySelector('[data-key="a"]');
    window.__farmRangeX = list.querySelector('[data-key="x"]');
    window.__farmRangeMoves = 0;
    const insertBefore = list.insertBefore.bind(list);
    list.insertBefore = (node, anchor) => {
      if (node.parentNode === list && node.matches?.("[data-key]")) {
        window.__farmRangeMoves += 1;
      }
      return insertBefore(node, anchor);
    };
  });
  await page.locator(`${keyedRanges} [data-action="rotate-ranges"]`).click();
  const primaryRangeOrder = await page
    .locator(`${keyedRanges} [data-range="primary"]`)
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-key")));
  const secondaryRangeOrder = await page
    .locator(`${keyedRanges} [data-range="secondary"]`)
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-key")));
  assert.deepEqual(primaryRangeOrder, ["d", "a", "b", "c"]);
  assert.deepEqual(secondaryRangeOrder, ["z", "y", "x"]);
  assert.equal(await page.locator(keyedRangesList).getAttribute("data-rows"), "7");
  assert.equal(await page.locator(keyedRangesList).evaluate((root) => root.tagName), "ARTICLE");
  assert.equal(await page.evaluate(() => window.__farmRangeMoves), 3);
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmRangeRoot ===
          document.querySelector(
            '[data-experiment="keyed-ranges"][data-list="ranges"]',
          ) &&
        window.__farmRangeHeader ===
          document.querySelector(
            '[data-experiment="keyed-ranges"] [data-static="range-header"]',
          ) &&
        window.__farmRangeDivider ===
          document.querySelector(
            '[data-experiment="keyed-ranges"] [data-static="range-divider"]',
          ) &&
        window.__farmRangeFooter ===
          document.querySelector(
            '[data-experiment="keyed-ranges"] [data-static="range-footer"]',
          ) &&
        window.__farmRangeA ===
          document.querySelector('[data-experiment="keyed-ranges"] [data-key="a"]') &&
        window.__farmRangeX ===
          document.querySelector('[data-experiment="keyed-ranges"] [data-key="x"]'),
    ),
    true,
    "keyed ranges did not preserve their rows and static shell",
  );
  await page.locator(`${keyedRanges} [data-action="clear-ranges"]`).click();
  await assertText(page, `${keyedRanges} [data-metric="rows"]`, "0");
  assert.equal(await page.locator(keyedRangesList).getAttribute("data-rows"), "0");
  assert.equal(await page.locator(`${keyedRanges} [data-key]`).count(), 0);
  await assertText(page, `${keyedRanges} [data-range-summary]`, "0 ROWS / ROOT SHELL");
  await page.locator(`${keyedRanges} [data-action="stress-ranges"]`).click();
  await assertText(page, `${keyedRanges} [data-metric="rows"]`, "1024");
  assert.equal(await page.locator(keyedRangesList).getAttribute("data-rows"), "1024");
  assert.equal(await page.locator(`${keyedRanges} [data-key]`).count(), 1024);
  const keyedRangesFinalExecutions = await readNumber(
    page,
    `${keyedRanges} [data-metric="executions"]`,
  );
  assert.equal(keyedRangesFinalExecutions - keyedRangesInitialExecutions, 0);

  const rowConditionals = '[data-experiment="keyed-row-conditionals"]';
  const rowConditionalsInitialExecutions = await readNumber(
    page,
    `${rowConditionals} [data-metric="executions"]`,
  );
  await assertText(page, `${rowConditionals} [data-metric="details"]`, "2");
  await assertText(page, `${rowConditionals} [data-metric="completed"]`, "1");
  await page.evaluate(() => {
    window.__farmConditionalRowA = document.querySelector(
      '[data-experiment="keyed-row-conditionals"] [data-key="a"]',
    );
  });

  const conditionalRowA = `${rowConditionals} [data-key="a"]`;
  const conditionalRowB = `${rowConditionals} [data-key="b"]`;
  await page.locator(`${conditionalRowA} [data-action="toggle-row-status"]`).click();
  await assertText(page, `${conditionalRowA} [data-slot="status"]`, "In progress");
  await assertText(page, `${rowConditionals} [data-metric="completed"]`, "0");
  await assertText(
    page,
    `${conditionalRowA} [data-slot="details"]`,
    "Compiler graph keeps its keyed DOM identity.",
  );

  await page.locator(`${conditionalRowB} [data-action="toggle-row-details"]`).click();
  await assertText(
    page,
    `${conditionalRowB} [data-slot="details"]`,
    "Hydration checks keeps its keyed DOM identity.",
  );
  await assertText(page, `${rowConditionals} [data-metric="details"]`, "3");

  await page.locator(`${rowConditionals} [data-action="rotate-conditional-rows"]`).click();
  assert.deepEqual(
    await page
      .locator(`${rowConditionals} [data-list="row-conditionals"] > li`)
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-key"))),
    ["c", "a", "b"],
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmConditionalRowA ===
        document.querySelector('[data-experiment="keyed-row-conditionals"] [data-key="a"]'),
    ),
    true,
    "React did not preserve a row-local conditional boundary through the reorder",
  );
  await page.locator(`${conditionalRowB} [data-action="toggle-row-status"]`).click();
  await assertText(
    page,
    `${conditionalRowB} [data-slot="status"]`,
    "Hydration checks complete",
  );
  await assertText(page, `${rowConditionals} [data-metric="completed"]`, "1");
  const rowConditionalsFinalExecutions = await readNumber(
    page,
    `${rowConditionals} [data-metric="executions"]`,
  );
  assert.equal(rowConditionalsFinalExecutions - rowConditionalsInitialExecutions, 0);

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

  const recursive = '[data-experiment="recursive-host-blocks"]';
  const recursiveOwnerInitialExecutions = await readNumber(
    page,
    `${recursive} [data-metric="recursive-owner-executions"]`,
  );
  await assertText(page, `${recursive} [data-metric="recursive-open"]`, "open");
  await page.evaluate(() => {
    window.__farmRecursiveOuter = document.querySelector("[data-recursive-outer]");
    window.__farmRecursiveStatic = document.querySelector("[data-recursive-static]");
    window.__farmRecursiveRows = Object.fromEntries(
      [...document.querySelectorAll("[data-recursive-row]")].map((row) => [
        row.getAttribute("data-recursive-row"),
        row,
      ]),
    );
  });

  await page.locator(`${recursive} [data-action="recursive-update"]`).click();
  await assertText(page, `${recursive} [data-metric="recursive-updates"]`, "1");
  await assertText(page, `${recursive} [data-recursive-details]`, "Details 1");
  assert.deepEqual(
    await page.locator(`${recursive} [data-recursive-row]`).allTextContents(),
    ["Gamma · updated", "Beta", "Alpha"],
  );
  assert.equal(
    await page.evaluate(() =>
      Object.entries(window.__farmRecursiveRows).every(
        ([key, row]) => row === document.querySelector(`[data-recursive-row="${key}"]`),
      ),
    ),
    true,
    "recursive keyed ranges replaced a surviving row",
  );
  assert.equal(
    await page.evaluate(
      () => window.__farmRecursiveOuter === document.querySelector("[data-recursive-outer]"),
    ),
    true,
    "a nested update replaced the outer compiler-owned branch",
  );
  assert.equal(
    await page.evaluate(
      () => window.__farmRecursiveStatic === document.querySelector("[data-recursive-static]"),
    ),
    true,
    "a nested update replaced the recursive static sibling",
  );

  await page.locator(`${recursive} [data-action="recursive-hide-update"]`).click();
  await assertText(page, `${recursive} [data-metric="recursive-open"]`, "closed");
  assert.equal(await page.locator(`${recursive} [data-recursive-outer]`).count(), 0);
  await page.locator(`${recursive} [data-action="recursive-hidden-update"]`).click();
  await assertText(page, `${recursive} [data-metric="recursive-updates"]`, "3");
  assert.equal(await page.locator(`${recursive} [data-recursive-outer]`).count(), 0);

  await page.locator(`${recursive} [data-action="recursive-show"]`).click();
  await assertText(page, `${recursive} [data-metric="recursive-open"]`, "open");
  await assertText(page, `${recursive} [data-recursive-details]`, "Details 3");
  assert.deepEqual(
    await page.locator(`${recursive} [data-recursive-row]`).allTextContents(),
    ["Gamma · updated · updated", "Beta", "Alpha · updated"],
  );
  const recursiveOwnerFinalExecutions = await readNumber(
    page,
    `${recursive} [data-metric="recursive-owner-executions"]`,
  );
  assert.equal(recursiveOwnerFinalExecutions - recursiveOwnerInitialExecutions, 0);

  const keyedHostRows = '[data-experiment="keyed-row-host-blocks"]';
  const keyedHostOwnerInitialExecutions = await readNumber(
    page,
    `${keyedHostRows} [data-metric="keyed-host-owner-executions"]`,
  );
  await assertText(page, `${keyedHostRows} [data-metric="keyed-host-rows"]`, "1000");
  await assertText(page, `${keyedHostRows} [data-metric="keyed-host-first"]`, "row-0");
  assert.equal(await page.locator(`${keyedHostRows} [data-keyed-host-row]`).count(), 1000);
  await page.evaluate(() => {
    const list = document.querySelector("[data-keyed-host-list]");
    window.__farmKeyedHostRow0 = document.querySelector('[data-keyed-host-row="row-0"]');
    window.__farmKeyedHostRow12 = document.querySelector('[data-keyed-host-row="row-12"]');
    window.__farmKeyedHostRow12Article = window.__farmKeyedHostRow12.querySelector("article");
    window.__farmKeyedHostRow12Before = window.__farmKeyedHostRow12.querySelector(
      "[data-keyed-host-status] > i",
    );
    window.__farmKeyedHostRow12After = window.__farmKeyedHostRow12.querySelector(
      "[data-keyed-host-status] > b",
    );
    window.__farmKeyedHostMoves = 0;
    const insertBefore = list.insertBefore.bind(list);
    list.insertBefore = (node, anchor) => {
      if (node.parentNode === list && node.matches?.("[data-keyed-host-row]")) {
        window.__farmKeyedHostMoves += 1;
      }
      return insertBefore(node, anchor);
    };
  });

  await page.locator(`${keyedHostRows} [data-action="keyed-host-rotate"]`).click();
  await assertText(page, `${keyedHostRows} [data-metric="keyed-host-updates"]`, "1");
  await assertText(page, `${keyedHostRows} [data-metric="keyed-host-first"]`, "row-1");
  await assertText(
    page,
    `${keyedHostRows} [data-keyed-host-row="row-0"] [data-keyed-host-branch]`,
    "Task 0 · branch replaced open",
  );
  await assertText(
    page,
    `${keyedHostRows} [data-keyed-host-row="row-12"] strong`,
    "Task 12 · nested patched complete",
  );
  await assertText(
    page,
    `${keyedHostRows} [data-keyed-host-row="row-12"] [data-keyed-host-extra]`,
    "Task 12 · nested patched expanded",
  );
  assert.equal(
    await page.locator(
      `${keyedHostRows} [data-keyed-host-row="row-12"] [data-keyed-host-detail]`,
    ).count(),
    0,
  );
  assert.equal(
    await page.locator(
      `${keyedHostRows} [data-keyed-host-row="row-12"] article`,
    ).evaluate((article) => article.style.opacity),
    "0.72",
  );
  assert.equal(await page.evaluate(() => window.__farmKeyedHostMoves), 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmKeyedHostRow0 ===
          document.querySelector('[data-keyed-host-row="row-0"]') &&
        window.__farmKeyedHostRow12 ===
          document.querySelector('[data-keyed-host-row="row-12"]') &&
        window.__farmKeyedHostRow12Article ===
          document.querySelector('[data-keyed-host-row="row-12"] article') &&
        window.__farmKeyedHostRow12Before ===
          document.querySelector('[data-keyed-host-row="row-12"] [data-keyed-host-status] > i') &&
        window.__farmKeyedHostRow12After ===
          document.querySelector('[data-keyed-host-row="row-12"] [data-keyed-host-status] > b'),
    ),
    true,
    "the keyed row host update replaced a surviving row, branch, or static sibling",
  );

  await page.locator(`${keyedHostRows} [data-action="keyed-host-replace"]`).click();
  await assertText(page, `${keyedHostRows} [data-metric="keyed-host-updates"]`, "2");
  await assertText(page, `${keyedHostRows} [data-metric="keyed-host-rows"]`, "1000");
  assert.equal(
    await page.locator(`${keyedHostRows} [data-keyed-host-row="row-10"]`).count(),
    0,
  );
  await assertText(
    page,
    `${keyedHostRows} [data-keyed-host-row="inserted-1"] [data-keyed-host-detail]`,
    "Inserted after update 1 detail",
  );
  const keyedHostOwnerFinalExecutions = await readNumber(
    page,
    `${keyedHostRows} [data-metric="keyed-host-owner-executions"]`,
  );
  assert.equal(keyedHostOwnerFinalExecutions - keyedHostOwnerInitialExecutions, 0);

  const nestedKeyedRows = '[data-experiment="nested-keyed-rows"]';
  const nestedKeyedOwnerInitialExecutions = await readNumber(
    page,
    `${nestedKeyedRows} [data-metric="nested-keyed-owner-executions"]`,
  );
  await assertText(page, `${nestedKeyedRows} [data-metric="nested-keyed-projects"]`, "256");
  await assertText(page, `${nestedKeyedRows} [data-metric="nested-keyed-tasks"]`, "2048");
  assert.equal(await page.locator(`${nestedKeyedRows} [data-nested-project]`).count(), 256);
  assert.equal(await page.locator(`${nestedKeyedRows} [data-nested-task]`).count(), 2048);
  await page.evaluate(() => {
    const projectList = document.querySelector("[data-nested-project-list]");
    const project = document.querySelector('[data-nested-project="project-12"]');
    const taskList = project.querySelector('[data-nested-task-list="project-12"]');
    window.__farmNestedProject12 = project;
    window.__farmNestedTask120 = project.querySelector('[data-nested-task="task-12-0"]');
    window.__farmNestedTask127 = project.querySelector('[data-nested-task="task-12-7"]');
    window.__farmNestedStaticBefore = project.querySelector('[data-nested-static="before"]');
    window.__farmNestedStaticAfter = project.querySelector('[data-nested-static="after"]');
    window.__farmNestedOuterMoves = 0;
    window.__farmNestedInnerMoves = 0;
    const outerInsertBefore = projectList.insertBefore.bind(projectList);
    projectList.insertBefore = (node, anchor) => {
      if (node.parentNode === projectList && node.matches?.("[data-nested-project]")) {
        window.__farmNestedOuterMoves += 1;
      }
      return outerInsertBefore(node, anchor);
    };
    const innerInsertBefore = taskList.insertBefore.bind(taskList);
    taskList.insertBefore = (node, anchor) => {
      if (node.parentNode === taskList && node.matches?.("[data-nested-task]")) {
        window.__farmNestedInnerMoves += 1;
      }
      return innerInsertBefore(node, anchor);
    };
  });

  await page.locator(`${nestedKeyedRows} [data-action="nested-keyed-reorder"]`).click();
  await assertText(page, `${nestedKeyedRows} [data-metric="nested-keyed-updates"]`, "1");
  assert.equal(
    await page.locator(`${nestedKeyedRows} [data-nested-project]`).first().getAttribute(
      "data-nested-project",
    ),
    "project-1",
  );
  assert.deepEqual(
    await page
      .locator(`${nestedKeyedRows} [data-nested-project="project-12"] [data-nested-task]`)
      .evaluateAll((tasks) => tasks.map((task) => task.getAttribute("data-nested-task"))),
    [
      "task-12-7",
      "task-12-0",
      "task-12-1",
      "task-12-2",
      "task-12-3",
      "task-12-4",
      "task-12-5",
      "task-12-6",
    ],
  );
  await assertText(
    page,
    `${nestedKeyedRows} [data-nested-task="task-12-7"]`,
    "Task 12.7 · moved",
  );
  assert.equal(await page.evaluate(() => window.__farmNestedOuterMoves), 1);
  assert.equal(await page.evaluate(() => window.__farmNestedInnerMoves), 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmNestedProject12 ===
          document.querySelector('[data-nested-project="project-12"]') &&
        window.__farmNestedTask120 ===
          document.querySelector('[data-nested-task="task-12-0"]') &&
        window.__farmNestedTask127 ===
          document.querySelector('[data-nested-task="task-12-7"]') &&
        window.__farmNestedStaticBefore ===
          document.querySelector(
            '[data-nested-project="project-12"] [data-nested-static="before"]',
          ) &&
        window.__farmNestedStaticAfter ===
          document.querySelector(
            '[data-nested-project="project-12"] [data-nested-static="after"]',
          ),
    ),
    true,
    "nested keyed reconciliation replaced a surviving project, task, or static sibling",
  );

  await page.locator(`${nestedKeyedRows} [data-action="nested-keyed-replace"]`).click();
  await assertText(page, `${nestedKeyedRows} [data-metric="nested-keyed-updates"]`, "2");
  await assertText(page, `${nestedKeyedRows} [data-metric="nested-keyed-tasks"]`, "2048");
  assert.equal(
    await page.locator(`${nestedKeyedRows} [data-nested-task="task-12-1"]`).count(),
    0,
  );
  await assertText(
    page,
    `${nestedKeyedRows} [data-nested-task="inserted-task-1"]`,
    "Inserted after update 1",
  );
  const nestedKeyedOwnerFinalExecutions = await readNumber(
    page,
    `${nestedKeyedRows} [data-metric="nested-keyed-owner-executions"]`,
  );
  assert.equal(nestedKeyedOwnerFinalExecutions - nestedKeyedOwnerInitialExecutions, 0);

  const recursiveKeyedScopes = '[data-experiment="recursive-keyed-scopes"]';
  const recursiveKeyedOwnerInitialExecutions = await readNumber(
    page,
    `${recursiveKeyedScopes} [data-metric="recursive-keyed-owner-executions"]`,
  );
  await assertText(page, `${recursiveKeyedScopes} [data-metric="recursive-keyed-boards"]`, "48");
  await assertText(
    page,
    `${recursiveKeyedScopes} [data-metric="recursive-keyed-columns"]`,
    "288",
  );
  await assertText(
    page,
    `${recursiveKeyedScopes} [data-metric="recursive-keyed-cards"]`,
    "2304",
  );
  assert.equal(await page.locator(`${recursiveKeyedScopes} [data-recursive-board]`).count(), 48);
  assert.equal(
    await page.locator(`${recursiveKeyedScopes} [data-recursive-column]`).count(),
    288,
  );
  assert.equal(await page.locator(`${recursiveKeyedScopes} [data-recursive-card]`).count(), 2304);
  await page.evaluate(() => {
    const boardList = document.querySelector("[data-recursive-board-list]");
    const board = document.querySelector('[data-recursive-board="recursive-board-12"]');
    const columnList = board.querySelector(
      '[data-recursive-column-list="recursive-board-12"]',
    );
    const column = board.querySelector(
      '[data-recursive-column="recursive-column-12-3"]',
    );
    const cardList = column.querySelector(
      '[data-recursive-card-list="recursive-column-12-3"]',
    );
    window.__farmRecursiveBoard12 = board;
    window.__farmRecursiveColumn123 = column;
    window.__farmRecursiveCard1230 = column.querySelector(
      '[data-recursive-card="recursive-card-12-3-0"]',
    );
    window.__farmRecursiveCard1237 = column.querySelector(
      '[data-recursive-card="recursive-card-12-3-7"]',
    );
    window.__farmRecursiveColumnsBefore = board.querySelector(
      '[data-recursive-static="columns-before"]',
    );
    window.__farmRecursiveColumnsAfter = board.querySelector(
      '[data-recursive-static="columns-after"]',
    );
    window.__farmRecursiveCardsBefore = column.querySelector(
      '[data-recursive-static="cards-before"]',
    );
    window.__farmRecursiveCardsAfter = column.querySelector(
      '[data-recursive-static="cards-after"]',
    );
    window.__farmRecursiveBoardMoves = 0;
    window.__farmRecursiveColumnMoves = 0;
    window.__farmRecursiveCardMoves = 0;
    const boardInsertBefore = boardList.insertBefore.bind(boardList);
    boardList.insertBefore = (node, anchor) => {
      if (node.parentNode === boardList && node.matches?.("[data-recursive-board]")) {
        window.__farmRecursiveBoardMoves += 1;
      }
      return boardInsertBefore(node, anchor);
    };
    const columnInsertBefore = columnList.insertBefore.bind(columnList);
    columnList.insertBefore = (node, anchor) => {
      if (node.parentNode === columnList && node.matches?.("[data-recursive-column]")) {
        window.__farmRecursiveColumnMoves += 1;
      }
      return columnInsertBefore(node, anchor);
    };
    const cardInsertBefore = cardList.insertBefore.bind(cardList);
    cardList.insertBefore = (node, anchor) => {
      if (node.parentNode === cardList && node.matches?.("[data-recursive-card]")) {
        window.__farmRecursiveCardMoves += 1;
      }
      return cardInsertBefore(node, anchor);
    };
  });

  await page.locator(`${recursiveKeyedScopes} [data-action="recursive-keyed-reorder"]`).click();
  await assertText(
    page,
    `${recursiveKeyedScopes} [data-metric="recursive-keyed-updates"]`,
    "1",
  );
  assert.equal(
    await page
      .locator(`${recursiveKeyedScopes} [data-recursive-board]`)
      .first()
      .getAttribute("data-recursive-board"),
    "recursive-board-1",
  );
  assert.deepEqual(
    await page
      .locator(
        `${recursiveKeyedScopes} [data-recursive-board="recursive-board-12"] [data-recursive-column]`,
      )
      .evaluateAll((columns) => columns.map((column) => column.getAttribute("data-recursive-column"))),
    [
      "recursive-column-12-5",
      "recursive-column-12-0",
      "recursive-column-12-1",
      "recursive-column-12-2",
      "recursive-column-12-3",
      "recursive-column-12-4",
    ],
  );
  assert.deepEqual(
    await page
      .locator(
        `${recursiveKeyedScopes} [data-recursive-column="recursive-column-12-3"] [data-recursive-card]`,
      )
      .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-recursive-card"))),
    [
      "recursive-card-12-3-7",
      "recursive-card-12-3-0",
      "recursive-card-12-3-1",
      "recursive-card-12-3-2",
      "recursive-card-12-3-3",
      "recursive-card-12-3-4",
      "recursive-card-12-3-5",
      "recursive-card-12-3-6",
    ],
  );
  await assertText(
    page,
    `${recursiveKeyedScopes} [data-recursive-card="recursive-card-12-3-7"]`,
    "Card 12.3.7 · moved",
  );
  assert.equal(await page.evaluate(() => window.__farmRecursiveBoardMoves), 1);
  assert.equal(await page.evaluate(() => window.__farmRecursiveColumnMoves), 1);
  assert.equal(await page.evaluate(() => window.__farmRecursiveCardMoves), 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmRecursiveBoard12 ===
          document.querySelector('[data-recursive-board="recursive-board-12"]') &&
        window.__farmRecursiveColumn123 ===
          document.querySelector('[data-recursive-column="recursive-column-12-3"]') &&
        window.__farmRecursiveCard1230 ===
          document.querySelector('[data-recursive-card="recursive-card-12-3-0"]') &&
        window.__farmRecursiveCard1237 ===
          document.querySelector('[data-recursive-card="recursive-card-12-3-7"]') &&
        window.__farmRecursiveColumnsBefore ===
          document.querySelector(
            '[data-recursive-board="recursive-board-12"] [data-recursive-static="columns-before"]',
          ) &&
        window.__farmRecursiveColumnsAfter ===
          document.querySelector(
            '[data-recursive-board="recursive-board-12"] [data-recursive-static="columns-after"]',
          ) &&
        window.__farmRecursiveCardsBefore ===
          document.querySelector(
            '[data-recursive-column="recursive-column-12-3"] [data-recursive-static="cards-before"]',
          ) &&
        window.__farmRecursiveCardsAfter ===
          document.querySelector(
            '[data-recursive-column="recursive-column-12-3"] [data-recursive-static="cards-after"]',
          ),
    ),
    true,
    "recursive keyed reconciliation replaced a surviving board, column, card, or static sibling",
  );

  await page.locator(`${recursiveKeyedScopes} [data-action="recursive-keyed-replace"]`).click();
  await assertText(
    page,
    `${recursiveKeyedScopes} [data-metric="recursive-keyed-updates"]`,
    "2",
  );
  await assertText(
    page,
    `${recursiveKeyedScopes} [data-metric="recursive-keyed-cards"]`,
    "2304",
  );
  assert.equal(
    await page
      .locator(
        `${recursiveKeyedScopes} [data-recursive-card="recursive-card-12-3-1"]`,
      )
      .count(),
    0,
  );
  await assertText(
    page,
    `${recursiveKeyedScopes} [data-recursive-card="recursive-inserted-card-1"]`,
    "Inserted after update 1",
  );
  const recursiveKeyedOwnerFinalExecutions = await readNumber(
    page,
    `${recursiveKeyedScopes} [data-metric="recursive-keyed-owner-executions"]`,
  );
  assert.equal(recursiveKeyedOwnerFinalExecutions - recursiveKeyedOwnerInitialExecutions, 0);

  const mixedRanges = '[data-experiment="mixed-ranges"]';
  const mixedRangeOwnerInitialExecutions = await readNumber(
    page,
    `${mixedRanges} [data-metric="mixed-range-owner-executions"]`,
  );
  await page.evaluate(() => {
    window.__farmMixedItem0 = document.querySelector('[data-mixed-item="mixed-item-0"]');
    window.__farmMixedTag00 = document.querySelector('[data-mixed-tag="mixed-tag-0-0"]');
    window.__farmMixedHeader = document.querySelector('[data-mixed-static="header"]');
    window.__farmMixedRowsBefore = document.querySelector('[data-mixed-static="rows-before"]');
    window.__farmMixedFooter = document.querySelector('[data-mixed-static="footer"]');
    window.__farmMixedRowMoves = 0;
    window.__farmMixedTagMoves = 0;
    const rows = document.querySelector("[data-mixed-range-list]");
    const tags = document.querySelector('[data-mixed-tag-list="mixed-item-0"]');
    const rowInsertBefore = rows.insertBefore.bind(rows);
    rows.insertBefore = (node, anchor) => {
      if (node.parentNode === rows && node.matches?.("[data-mixed-item]")) {
        window.__farmMixedRowMoves += 1;
      }
      return rowInsertBefore(node, anchor);
    };
    const tagInsertBefore = tags.insertBefore.bind(tags);
    tags.insertBefore = (node, anchor) => {
      if (node.parentNode === tags && node.matches?.("[data-mixed-tag]")) {
        window.__farmMixedTagMoves += 1;
      }
      return tagInsertBefore(node, anchor);
    };
  });

  await page.locator(`${mixedRanges} [data-action="mixed-range-reconcile"]`).click();
  await assertText(page, `${mixedRanges} [data-metric="mixed-range-updates"]`, "1");
  await assertText(page, `${mixedRanges} [data-metric="mixed-range-loading"]`, "shown");
  await assertText(page, `${mixedRanges} [data-metric="mixed-range-status"]`, "error");
  assert.equal(await page.locator(`${mixedRanges} [data-mixed-loading]`).count(), 1);
  assert.equal(
    await page.locator(`${mixedRanges} [data-mixed-item]`).first().getAttribute("data-mixed-item"),
    "mixed-item-31",
  );
  await assertText(page, `${mixedRanges} [data-mixed-item="mixed-item-0"] h3`, "Item 0 · updated");
  assert.equal(
    await page.locator(`${mixedRanges} [data-mixed-visible="mixed-item-0"]`).count(),
    0,
  );
  assert.deepEqual(
    await page
      .locator(`${mixedRanges} [data-mixed-item="mixed-item-0"] [data-mixed-tag]`)
      .evaluateAll((tags) => tags.map((tag) => tag.getAttribute("data-mixed-tag"))),
    ["mixed-tag-0-2", "mixed-tag-0-0", "mixed-tag-0-1"],
  );
  assert.equal(await page.evaluate(() => window.__farmMixedRowMoves), 1);
  assert.equal(await page.evaluate(() => window.__farmMixedTagMoves), 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.__farmMixedItem0 === document.querySelector('[data-mixed-item="mixed-item-0"]') &&
        window.__farmMixedTag00 === document.querySelector('[data-mixed-tag="mixed-tag-0-0"]') &&
        window.__farmMixedHeader === document.querySelector('[data-mixed-static="header"]') &&
        window.__farmMixedRowsBefore ===
          document.querySelector('[data-mixed-static="rows-before"]') &&
        window.__farmMixedFooter === document.querySelector('[data-mixed-static="footer"]'),
    ),
    true,
    "mixed range reconciliation replaced a surviving row, nested tag, or static sibling",
  );

  await page.locator(`${mixedRanges} [data-action="mixed-range-replace"]`).click();
  await assertText(page, `${mixedRanges} [data-metric="mixed-range-updates"]`, "2");
  await assertText(page, `${mixedRanges} [data-metric="mixed-range-rows"]`, "32");
  assert.equal(
    await page.locator(`${mixedRanges} [data-mixed-item="mixed-item-1"]`).count(),
    0,
  );
  await assertText(
    page,
    `${mixedRanges} [data-mixed-item="mixed-inserted-1"] h3`,
    "Inserted after update 1",
  );
  const mixedRangeOwnerFinalExecutions = await readNumber(
    page,
    `${mixedRanges} [data-metric="mixed-range-owner-executions"]`,
  );
  assert.equal(mixedRangeOwnerFinalExecutions - mixedRangeOwnerInitialExecutions, 0);

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
          editableKeyedRows: {
            edits: 3,
            stressRows: 256,
            updateExecutions:
              editableListFinalExecutions - editableListInitialExecutions,
            selectionPreserved: true,
            identityPreserved: true,
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
          conditionalRanges: {
            ranges: 2,
            branch: "enabled",
            updateExecutions:
              conditionalRangesFinalExecutions - conditionalRangesInitialExecutions,
            rootHostIdentityPreserved: conditionalRangesIdentity.root,
            staticSiblingIdentityPreserved: Object.values(conditionalRangesIdentity).every(Boolean),
            markerNodes: 0,
            owner: "Farm root conditional ranges",
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
          keyedRanges: {
            ranges: 2,
            rotation: {
              primary: primaryRangeOrder,
              secondary: secondaryRangeOrder,
              lisMoves: 3,
            },
            stressRows: 1024,
            updateExecutions:
              keyedRangesFinalExecutions - keyedRangesInitialExecutions,
            staticSiblingIdentityPreserved: true,
            keyedDomIdentityPreserved: true,
            rootHostIdentityPreserved: true,
            owner: "Farm root keyed ranges",
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
          keyedRowConditionals: {
            order: ["c", "a", "b"],
            openDetails: 3,
            completed: 1,
            updateExecutions:
              rowConditionalsFinalExecutions - rowConditionalsInitialExecutions,
            keyedDomIdentityPreserved: true,
            structuralOwner: "React",
            conditionalScheduling: "Farm snapshots",
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
          recursiveHostBlocks: {
            updates: 3,
            keyedOrder: ["c", "b", "a"],
            deepestConditional: "Details 3",
            keyedDomIdentityPreserved: true,
            staleSubscriptionsAfterHide: 0,
            ownerUpdateExecutions:
              recursiveOwnerFinalExecutions - recursiveOwnerInitialExecutions,
          },
          keyedRowHostBlocks: {
            rows: 1000,
            firstKey: "row-1",
            lisMoves: 1,
            sameBranchIdentityPreserved: true,
            nestedConditionPatched: true,
            removedAndInserted: true,
            ownerUpdateExecutions:
              keyedHostOwnerFinalExecutions - keyedHostOwnerInitialExecutions,
          },
          nestedKeyedRows: {
            projects: 256,
            tasks: 2048,
            outerLisMoves: 1,
            innerLisMoves: 1,
            outerIdentityPreserved: true,
            innerIdentityPreserved: true,
            staticSiblingIdentityPreserved: true,
            ownerUpdateExecutions:
              nestedKeyedOwnerFinalExecutions - nestedKeyedOwnerInitialExecutions,
          },
          recursiveKeyedScopes: {
            boards: 48,
            columns: 288,
            cards: 2304,
            boardLisMoves: 1,
            columnLisMoves: 1,
            cardLisMoves: 1,
            identityPreservedAtEveryLevel: true,
            staticSiblingIdentityPreserved: true,
            ownerUpdateExecutions:
              recursiveKeyedOwnerFinalExecutions - recursiveKeyedOwnerInitialExecutions,
          },
          mixedRanges: {
            rows: 32,
            outerLisMoves: 1,
            nestedLisMoves: 1,
            simultaneousConditionalUpdates: 2,
            recursivelyNestedRanges: true,
            staticSiblingIdentityPreserved: true,
            removedAndInserted: true,
            ownerUpdateExecutions:
              mixedRangeOwnerFinalExecutions - mixedRangeOwnerInitialExecutions,
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
