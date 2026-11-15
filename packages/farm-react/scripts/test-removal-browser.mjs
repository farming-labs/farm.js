// Development-browser correctness check for maintained target-free keyed fixtures.
// Build @farm.js/react first. Optionally pass --executable-path /path/to/chrome.
// Use --operations prepend to check the prepend-only runtime; defaults to filter,slice.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { createFarmRendererPlugin } from "../dist/vite.mjs";

const { values } = parseArgs({
  options: {
    "executable-path": { type: "string" },
    operations: { type: "string", default: "filter,slice" },
  },
});
const operations = values.operations.split(",");
assert.ok(
  operations.length > 0 &&
    operations.every((value) => ["filter", "slice", "prepend"].includes(value)),
);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(packageRoot, "../..");
const { chromium } = createRequire(`${repo}/package.json`)("@playwright/test");
const cacheDir = await mkdtemp(join(tmpdir(), "farm-removal-browser-"));
const results = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: values["executable-path"] });
  for (const reactivity of ["static", "hybrid"]) {
    for (const compiled of [false, true]) {
      const server = await createServer({
        configFile: false,
        root: packageRoot,
        cacheDir,
        logLevel: "error",
        css: { postcss: { plugins: [] } },
        resolve: {
          alias: { "@farm.js/react/compiler-runtime": `${packageRoot}/dist/compiler-runtime.mjs` },
        },
        server: { host: "127.0.0.1", port: 0 },
        optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime"] },
        plugins: [
          {
            name: "removal-browser-fixtures",
            enforce: "pre",
            async load(id) {
              if (!/\/fixtures\/runtime-size\/keyed-(filter|slice|prepend)\.tsx$/.test(id)) return;
              const source = await readFile(id, "utf8");
              return source
                .replace(
                  "<li data-id=",
                  "<li onClick={() => window.__rowClicks.push(row.id)} data-id=",
                )
                .replace(
                  "createRoot(document.body).render(",
                  "const root = createRoot(document.body); window.__unmount = () => root.unmount(); root.render(",
                );
            },
            configureServer(vite) {
              vite.middlewares.use((req, res, next) => {
                const operation = new URL(req.url, "http://localhost").pathname.slice(1);
                if (!operations.includes(operation)) return next();
                res.setHeader("content-type", "text/html");
                res.end(
                  `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script>window.__rowClicks=[]</script><script type="module" src="/@vite/client"></script><script type="module" src="/fixtures/runtime-size/keyed-${operation}.tsx"></script></body></html>`,
                );
              });
            },
          },
          ...createFarmRendererPlugin({
            rendererOptions: {
              compiler: compiled ? { reactivity, onUnsupported: "error" } : false,
            },
          }),
        ],
      });
      try {
        await server.listen();
        for (const operation of operations) {
          const transformed = await server.transformRequest(
            `/fixtures/runtime-size/keyed-${operation}.tsx`,
          );
          assert.equal(
            transformed.code.includes(
              operation === "prepend"
                ? "keyedRowsPrependOnlyRuntimeFeature"
                : "keyedRowsFilterOnlyRuntimeFeature",
            ),
            compiled,
          );
          if (compiled) assert.match(transformed.code, /delegateEvents: true/);
          const page = await browser.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
          });
          try {
            await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${operation}`);
            await page.waitForFunction(() => document.querySelectorAll("li").length === 1000);
            await page.evaluate(() => {
              window.__before = new Map(
                [...document.querySelectorAll("li")].map((row) => [row.dataset.id, row]),
              );
              document.querySelector("button").focus();
              document.querySelector("button").click();
            });
            await page.waitForFunction(
              (count) => document.querySelectorAll("li").length === count,
              operation === "prepend" ? 1001 : 999,
            );
            const result = await page.evaluate((operation) => {
              const expected =
                operation === "prepend"
                  ? [1000, ...Array(1000).keys()]
                  : [...Array(1000).keys()].filter(
                      (id) => id !== (operation === "filter" ? 500 : 0),
                    );
              const rows = [...document.querySelectorAll("li")];
              for (const index of [0, 499, rows.length - 1]) rows[index].click();
              const result = {
                content: rows.every(
                  (row, index) =>
                    row.dataset.id === String(expected[index]) &&
                    row.textContent === `Row ${expected[index]}`,
                ),
                identity: rows.every(
                  (row) => row.dataset.id === "1000" || window.__before.get(row.dataset.id) === row,
                ),
                focus: document.activeElement === document.querySelector("button"),
                calls: [...window.__rowClicks],
                expectedCalls: [expected[0], expected[499], expected.at(-1)],
              };
              window.__unmount();
              for (const row of rows) row.click();
              result.disposed =
                window.__rowClicks.length === 3 && document.querySelectorAll("li").length === 0;
              return result;
            }, operation);
            for (const field of ["content", "identity", "focus", "disposed"])
              assert.equal(result[field], true, `${operation}/${reactivity}/${compiled}: ${field}`);
            assert.deepEqual(result.calls, result.expectedCalls);
            assert.deepEqual(errors, []);
            results.push({ operation, reactivity, compiled, passed: true });
          } finally {
            await page.close();
          }
        }
      } finally {
        await server.close();
      }
    }
  }
  console.log(
    JSON.stringify({ node: process.version, browser: browser.version(), results }, null, 2),
  );
} finally {
  await browser?.close();
  await rm(cacheDir, { recursive: true, force: true });
}
