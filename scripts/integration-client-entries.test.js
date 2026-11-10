const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
// Bundle with the Vite that @farm.js/core depends on: it builds a Farm app's browser code.
const requireFromCore = createRequire(path.join(root, "packages", "farm", "package.json"));

// Integrations whose `./client` entry is imported by browser code.
const clientEntryPackages = [
  "farm-stripe",
  "farm-polar",
  "farm-autumn",
  "farm-email",
  "farm-auth0",
  "farm-supabase",
  "farm-workos",
];

const serverOnlyModule =
  /[\\/]node_modules[\\/](?:stripe|@polar-sh[\\/]sdk|autumn-js|standardwebhooks)[\\/]|(?:[\\/]packages[\\/]farm|[\\/]@farm\.js[\\/]core)[\\/]dist[\\/](?:index|integrations)\.mjs$/;
const nodeBuiltinModule = /^(?:node:|__vite-browser-external)/;
const secretRead = /process\.env|[A-Z]+_(?:SECRET_KEY|WEBHOOK_SECRET|ACCESS_TOKEN)/;

function clientExportTarget(manifest) {
  const entry = manifest.exports?.["./client"];
  return typeof entry === "string" ? entry : (entry?.import ?? entry?.default);
}

function isPublished(manifest, target) {
  const normalized = path.posix.normalize(target).replace(/^\.\//, "");
  return (manifest.files || []).some((file) => {
    const prefix = path.posix.normalize(file).replace(/^\.\//, "").replace(/\/$/, "");
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

async function bundleForBrowser(packageDir, entry) {
  const { build } = await import(pathToFileURL(requireFromCore.resolve("vite")).href);
  const result = await build({
    configFile: false,
    envFile: false,
    root: packageDir,
    logLevel: "silent",
    mode: "production",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      minify: false,
      emptyOutDir: false,
      lib: { entry, formats: ["es"], fileName: "client" },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((output) => output.output)
    .filter((file) => file.type === "chunk");
  return {
    code: chunks.map((chunk) => chunk.code).join("\n"),
    moduleIds: chunks.flatMap((chunk) => chunk.moduleIds),
  };
}

for (const directory of clientEntryPackages) {
  const packageDir = path.join(root, "packages", directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));

  test(`${manifest.name}/client is published and bundles for the browser without server code`, async () => {
    const target = clientExportTarget(manifest);
    assert.ok(target, `${manifest.name} must export ./client`);
    assert.ok(isPublished(manifest, target), `${manifest.name} files must include ${target}`);

    const entry = path.join(packageDir, target);
    assert.ok(
      fs.existsSync(entry),
      `${manifest.name} has not been built: ${target} is missing (run pnpm build).`,
    );

    const { code, moduleIds } = await bundleForBrowser(packageDir, entry);
    assert.deepEqual(
      moduleIds.filter((id) => serverOnlyModule.test(id)),
      [],
      "server SDK or server-only @farm.js/core entry in the browser bundle",
    );
    assert.deepEqual(
      moduleIds.filter((id) => nodeBuiltinModule.test(id)),
      [],
      "Node built-in in the browser bundle",
    );
    assert.doesNotMatch(code, secretRead, "browser bundle reads server environment secrets");
  });
}
