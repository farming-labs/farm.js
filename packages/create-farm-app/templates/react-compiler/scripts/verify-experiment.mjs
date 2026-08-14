import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const port = Number(process.env.FARM_EXPERIMENT_PORT || 4327);
const origin = `http://127.0.0.1:${port}`;
const serverEntry = path.resolve(".farm/.output/server/index.mjs");
const screenshotPath =
  process.env.FARM_EXPERIMENT_SCREENSHOT || "/tmp/farm-react-compiler-starter.png";

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

async function readNumber(page, selector) {
  return Number((await page.locator(selector).textContent())?.trim());
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const browserErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /compiler handles the rest/i }).waitFor();

  const executions = {};
  for (const pathName of ["compiled", "react"]) {
    const root = `[data-path="${pathName}"]`;
    executions[pathName] = {
      initial: await readNumber(page, `${root} [data-metric="executions"]`),
    };
    await page.locator(`${root} [data-action="update"]`).click();
    await page.locator(`${root} [data-action="update"]`).click();
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent?.trim() === "2",
      `${root} [data-metric="state"]`,
    );
    executions[pathName].final = await readNumber(page, `${root} [data-metric="executions"]`);
    executions[pathName].added = executions[pathName].final - executions[pathName].initial;
  }

  assert.equal(executions.compiled.added, 0);
  assert.equal(executions.react.added, 2);
  assert.deepEqual(browserErrors, []);

  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        productionUrl: origin,
        screenshot: screenshotPath,
        compiledUpdateExecutions: executions.compiled.added,
        reactUpdateExecutions: executions.react.added,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
