const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

async function assertNoProductionRefresh(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await assertNoProductionRefresh(file);
    } else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
      assert.doesNotMatch(
        await fs.readFile(file, "utf8"),
        /\/@(?:farm\/)?react-refresh|\$RefreshReg\$\(/,
        `Development Refresh must not enter the production browser output: ${file}`,
      );
    }
  }
}

// Only called with the smoke harness's own temporary generated app.
async function verifyCompilerDevelopment(appDirectory, { browserPath, enabled, port, screenshot }) {
  const { chromium, expect } = require("@playwright/test");
  const componentPath = path.join(appDirectory, "src/components/compiler-comparison.tsx");
  const original = await fs.readFile(componentPath, "utf8");
  const edited = original
    .replaceAll("value + 1", "value + 2")
    .replace("Update compiled state", "Update compiled state (edited)")
    .replace("Update React state", "Update React state (edited)");
  assert.notEqual(edited, original, "The starter counter must still be editable by this check.");

  // Farm's ordinary dev server binds localhost, which can resolve to IPv6.
  const origin = `http://localhost:${port}`;
  const server = spawn(
    process.execPath,
    [
      path.join(appDirectory, "node_modules/@farm.js/cli/bin/farm.js"),
      "dev",
      "--port",
      String(port),
    ],
    {
      cwd: appDirectory,
      env: {
        ...process.env,
        NODE_ENV: "development",
        FARM_REACT_COMPILER: String(enabled),
        FARM_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let spawnError;
  server.on("error", (error) => {
    spawnError = error;
  });
  const closed = new Promise((resolve) => server.once("close", resolve));
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      output = (output + chunk).slice(-64_000);
    });
  }
  let browser;
  let page;
  try {
    await expect
      .poll(
        async () => {
          if (spawnError) throw spawnError;
          if (server.exitCode !== null || server.signalCode !== null) {
            throw new Error(`Development server exited before readiness.\n${output}`);
          }
          try {
            const response = await fetch(origin, { signal: AbortSignal.timeout(2_000) });
            await response.body?.cancel();
            return response.status;
          } catch {
            return 0;
          }
        },
        { timeout: 60_000, message: "The generated development app must answer HTTP" },
      )
      .toBe(200);

    browser = await chromium.launch({ headless: true, executablePath: browserPath });
    page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const moduleResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/src/components/compiler-comparison.tsx",
    );
    await page.goto(origin, { waitUntil: "networkidle" });
    const moduleSource = await (await moduleResponse).text();
    assert.equal(
      moduleSource.includes("createCompiledComponent"),
      enabled,
      "The development module must use the requested compiler mode.",
    );
    await expect(page.locator("[data-compiler-status]")).toHaveText(`compiler: ${enabled}`);
    const documentToken = await page.evaluate(() => {
      window.__farmCompilerSmokeDocument = crypto.randomUUID();
      return window.__farmCompilerSmokeDocument;
    });
    const roots = ["compiled", "react"].map((name) => page.locator(`[data-path="${name}"]`));
    async function updateAndCheck(value) {
      for (const root of roots) {
        await root.locator("[data-action=update]").click();
        await expect(root.locator("[data-metric=state]")).toHaveText(String(value));
      }
    }
    await updateAndCheck(1);
    await updateAndCheck(2);

    for (const edit of [
      { source: edited, label: "Update compiled state (edited)", before: 2, after: 4 },
      { source: original, label: "Update compiled state", before: 4, after: 5 },
    ]) {
      await fs.writeFile(componentPath, edit.source);
      await expect(roots[0].locator("[data-action=update]")).toHaveAccessibleName(edit.label);
      assert.equal(
        await page.evaluate(() => window.__farmCompilerSmokeDocument),
        documentToken,
        "A component edit must not reload the document.",
      );
      for (const root of roots) {
        await expect(root.locator("[data-metric=state]")).toHaveText(String(edit.before));
      }
      await updateAndCheck(edit.after);
    }
    assert.deepEqual(errors, [], "The development browser must not report errors.");
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log(
      JSON.stringify(
        {
          result: "PASS",
          mode: "development",
          compilerEnabled: enabled,
          hotUpdates: 2,
          preservedState: true,
          finalState: 5,
          screenshot,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await page?.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    throw new Error(`Compiler development smoke failed (compiler: ${enabled}).\n${output}`, {
      cause: error,
    });
  } finally {
    try {
      await browser?.close();
    } finally {
      server.kill("SIGTERM");
      const stopped = await Promise.race([
        closed.then(() => true),
        delay(5_000, false, { ref: false }),
      ]);
      if (!stopped) {
        server.kill("SIGKILL");
        await closed;
      }
      await fs.writeFile(componentPath, original);
    }
  }
}

module.exports = { assertNoProductionRefresh, verifyCompilerDevelopment };
