import { expect, test } from "@playwright/test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const workspace = process.cwd();

async function fixture(renderer: string) {
  const example = path.join(
    workspace,
    "examples",
    renderer === "react" ? "hints-demo" : `${renderer}-renderer`,
  );
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-devtools-compat-"));
  try {
    const manifest = JSON.parse(await readFile(path.join(example, "package.json"), "utf8"));
    for (const name of ["src", "public", "tsconfig.json", "package.json"]) {
      const source = path.join(example, name);
      if (existsSync(source)) await cp(source, path.join(root, name), { recursive: true });
    }
    // Reuse each maintained example's exact installed dependencies, adding only DevTools.
    // Do not mutate the example or its node_modules, and do not copy optimizer caches.
    const dependencies = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      "@farm.js/devtools",
    ]);
    for (const name of dependencies) {
      const target = path.join(root, "node_modules", name);
      await mkdir(path.dirname(target), { recursive: true });
      const source =
        name === "@farm.js/devtools"
          ? path.join(workspace, "packages/farm-devtools")
          : await realpath(path.join(example, "node_modules", name));
      await symlink(source, target, process.platform === "win32" ? "junction" : "dir");
    }
    let config = await readFile(path.join(example, "farm.config.ts"), "utf8");
    if (renderer !== "react") {
      config = `import { devtools } from "@farm.js/devtools";\n${config}`;
    }
    // Dependencies are symlinked from the workspace, so allow it the way a pnpm workspace
    // root would; otherwise Vite rejects their real paths (for example DevTools fonts).
    config = config.replace(
      "defineConfig({",
      `defineConfig({
      ${renderer === "react" ? "" : "plugins: [devtools()],"}
      vite: { server: { host: "127.0.0.1", fs: { allow: [${JSON.stringify(await realpath(root))}, ${JSON.stringify(workspace)}] } } },`,
    );
    await writeFile(path.join(root, "farm.config.ts"), config);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const child = fork(path.join(workspace, "tests/e2e-devtools/serve-compat.mjs"), [], {
    cwd: root,
    execArgv: [],
    env: { ...process.env, NODE_ENV: "development", FARM_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let logs = "";
  child.stdout!.on("data", (data) => {
    logs += data;
  });
  child.stderr!.on("data", (data) => {
    logs += data;
  });
  const closed = once(child, "exit");
  const ready = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Compatibility server did not start:\n${logs}`)),
      20000,
    );
    child.once("message", (message: { port: number }) => {
      clearTimeout(timer);
      resolve(message.port);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Compatibility server exited (${code}):\n${logs}`));
    });
  });
  const close = async () => {
    if (child.connected) child.send("close");
    // Bound cleanup if the server cannot complete its normal disposal path.
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
      await closed;
    } finally {
      clearTimeout(timer);
      await rm(root, { recursive: true, force: true });
    }
  };
  return { ready, close, logs: () => logs };
}

for (const renderer of ["react", "preact", "solid", "vue", "svelte"]) {
  test(`${renderer}: DevTools preserves rendering and app interactions`, async ({ page }, info) => {
    test.skip(info.project.name !== "development");
    const app = await fixture(renderer);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const port = await app.ready;
      const origin = `http://127.0.0.1:${port}`;
      await page.goto(`${origin}/`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.getByRole("button", { name: "Open Farm DevTools" }).click();
      const panel = page.frameLocator('iframe[title="Farm.js DevTools"]');
      await expect(panel.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
      const snapshot = await page.request.get(`${origin}/__farm/devtools.json`);
      expect(snapshot.status()).toBe(200);
      expect(snapshot.headers()["cache-control"]).toContain("no-store");
      expect(
        (await snapshot.json()).plugins.some(
          (plugin: { name: string }) => plugin.name === "farm:devtools",
        ),
      ).toBe(true);
      await panel.getByRole("button", { name: "Inspect", exact: true }).click();
      const select = panel.getByRole("combobox", { name: "MODULE" });
      await expect(select).toBeEnabled();
      await expect(panel.getByRole("region", { name: "Source", exact: true })).toBeVisible();
      await expect(panel.getByRole("region", { name: "Served JavaScript" })).toBeVisible();
      await panel.getByRole("button", { name: "Close DevTools" }).click();
      await expect(page.locator('iframe[title="Farm.js DevTools"]')).toHaveCount(0);
      if (renderer === "react") {
        await page.getByRole("button", { name: "Count: 0", exact: true }).click();
        await expect(page.getByRole("button", { name: "Count: 1", exact: true })).toBeVisible();
      } else {
        await page.getByRole("button", { name: "Ready for a typed server call." }).click();
        await expect(
          page.getByRole("button", { name: /Hello, .* from the FARMJS server\./ }),
        ).toBeVisible();
      }
      expect(errors).toEqual([]);
    } finally {
      await app.close();
      await info.attach("compatibility-server.log", {
        body: app.logs(),
        contentType: "text/plain",
      });
    }
  });
}
