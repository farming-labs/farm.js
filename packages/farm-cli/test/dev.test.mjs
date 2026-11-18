import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire, register } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

const loadedCliRuntime = () =>
  Object.keys(require.cache).filter((file) => /[\\/]internal[\\/]cli-runtime\.c?js$/.test(file));

test("loading `farm dev` leaves the CLI's copy of core unloaded", () => {
  // The server loads core's ES modules; the CLI runtime would be a second, CommonJS copy.
  require("../dist/dev.js");
  assert.deepEqual(loadedCliRuntime(), []);
});

test("`farm dev` still checks React Server Components packages when core asks", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "farm-cli-dev-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  // Core's dev server calls the check only for `experimental.serverComponents`; this stand-in
  // for `@farm.js/core/server` calls it for any app.
  const server = path.join(dir, "core-server.mjs");
  await fs.writeFile(
    server,
    "export async function startDevServer(config, port, options) {\n" +
      "  return options.ensureServerComponentsPackages(\n" +
      '    { experimental: { serverComponents: { mode: "rsc" } } },\n' +
      "    config.root,\n" +
      "  );\n" +
      "}\n",
  );
  const hooks = path.join(dir, "hooks.mjs");
  await fs.writeFile(
    hooks,
    `export async function resolve(specifier, context, next) {\n` +
      `  if (specifier === "@farm.js/core/server") {\n` +
      `    return { url: ${JSON.stringify(pathToFileURL(server).href)}, shortCircuit: true };\n` +
      `  }\n` +
      `  return next(specifier, context);\n` +
      `}\n`,
  );
  register(pathToFileURL(hooks).href);
  await fs.writeFile(path.join(dir, "package.json"), '{"name":"rsc-app","private":true}');
  await fs.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await fs.mkdir(path.join(dir, "node_modules", "@farm.js", "core"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "node_modules", "@farm.js", "core", "package.json"),
    '{"name":"@farm.js/core","version":"0.1.40"}',
  );

  // CI never changes dependencies, so the check reports the missing packages instead.
  const saved = Object.fromEntries(
    ["CI", "FARM_SKIP_RSC_INSTALL", "FARM_SERVER_COMPONENTS_MODE"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  process.env.CI = "1";
  delete process.env.FARM_SKIP_RSC_INSTALL;
  delete process.env.FARM_SERVER_COMPONENTS_MODE;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const { startDevServer } = require("../dist/dev.js");
  await assert.rejects(
    startDevServer({ root: dir }),
    /CI does not change dependencies: run `pnpm add @farm\.js\/plugin/,
  );
  assert.equal(loadedCliRuntime().length, 1);
});
