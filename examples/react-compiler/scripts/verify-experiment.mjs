import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const port = Number(process.env.FARM_EXPERIMENT_PORT || 4327);
const origin = `http://127.0.0.1:${port}`;
const serverEntry = path.resolve(".farm/.output/server/index.mjs");
const screenshotPath =
  process.env.FARM_EXPERIMENT_SCREENSHOT || "/tmp/farm-react-aot-edge-lab.png";

await access(serverEntry);

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

  const keyed = '[data-experiment="keyed-fallback"]';
  const keyedInitialExecutions = await readNumber(
    page,
    `${keyed} [data-metric="executions"]`,
  );
  await page.locator(`${keyed} [data-action="add-item"]`).click();
  await page.locator(`${keyed} [data-action="add-item"]`).click();
  await assertText(page, `${keyed} [data-metric="items"]`, "3");
  const keyedFinalExecutions = await readNumber(
    page,
    `${keyed} [data-metric="executions"]`,
  );
  assert.equal(keyedFinalExecutions - keyedInitialExecutions, 2);
  assert.deepEqual(await page.locator(`${keyed} li`).allTextContents(), [
    "item-1",
    "item-2",
    "item-3",
  ]);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(browserErrors, []);

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        productionUrl: origin,
        screenshot: screenshotPath,
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
          keyedFallback: {
            items: 3,
            updateExecutions: keyedFinalExecutions - keyedInitialExecutions,
            owner: "React",
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
