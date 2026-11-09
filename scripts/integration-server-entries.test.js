const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");
const { readPublicPackages } = require("./public-packages");
const { exportTarget } = require("./smoke-packed-integrations");

// A backend-only app (`renderer: false`) installs no React, so every integration's server entry
// must load without it. Importing a value from the `@farm.js/core` root (or `/client`) breaks
// that: those entries also load Farm's React client.

// Entries where React is part of the product, not a stray import.
const reactEntries = new Map([
  ["@farm.js/email", "renders React Email templates"],
  ["@farm.js/integrations", "re-exports @farm.js/email"],
  ["@farm.js/integrations/email", "is @farm.js/email"],
  ["@farm.js/integrations/email/schedule", "is @farm.js/email/schedule"],
]);

const sourcePattern = /\.(?:[cm]?[jt]sx?)$/;
const callsDefineIntegration = /\bdefineIntegration\s*(?:<[^()]*>)?\s*\(/;

function sourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(entryPath);
    if (!sourcePattern.test(entry.name) || entry.name.endsWith(".d.ts")) return [];
    if (entry.name.includes(".test.") || entry.name.includes(".spec.")) return [];
    return [entryPath];
  });
}

/** Packages that define an integration, plus everything the compatibility package forwards. */
function integrationPackages() {
  const packages = readPublicPackages().filter((pkg) => pkg.name !== "@farm.js/core");
  const compatibility = packages.find((pkg) => pkg.name === "@farm.js/integrations");
  const forwarded = new Set(Object.keys(compatibility?.manifest.dependencies ?? {}));
  return packages.filter(
    (pkg) =>
      pkg === compatibility ||
      forwarded.has(pkg.name) ||
      sourceFiles(path.join(pkg.dir, "src")).some((file) =>
        callsDefineIntegration.test(fs.readFileSync(file, "utf8")),
      ),
  );
}

/** Every server entry: browser `client` bindings may use React, and are not checked here. */
function serverEntries(pkg) {
  return Object.entries(pkg.manifest.exports ?? {})
    .filter(([key]) => key === "." || (key.startsWith("./") && !key.includes("*")))
    .filter(([key]) => key !== "./package.json" && path.posix.basename(key) !== "client")
    .map(([key, value]) => ({
      specifier: key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`,
      file: path.resolve(pkg.dir, exportTarget(value, "import") ?? ""),
    }))
    .filter((entry) => !reactEntries.has(entry.specifier));
}

// Runs in a child `node`: pnpm puts the hoisted workspace on NODE_PATH, so React cannot be
// removed from disk, only refused by a resolve hook.
const blockReactLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (/^(?:react|react-dom)(?:\\/|$)/.test(specifier)) {
    const error = new Error("Cannot find package '" + specifier + "' imported from " + context.parentURL);
    error.code = "ERR_MODULE_NOT_FOUND";
    throw error;
  }
  return nextResolve(specifier, context);
}
`;
const resultMarker = "FARM_REACT_FREE_RESULTS:";
const loadEntries = `
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(${JSON.stringify(blockReactLoader)}));
const results = [];
for (const entry of JSON.parse(process.env.FARM_REACT_FREE_ENTRIES)) {
  try {
    await import(entry.url);
    results.push({ specifier: entry.specifier });
  } catch (error) {
    results.push({ specifier: entry.specifier, error: String(error?.message ?? error).split("\\n")[0] });
  }
}
process.stdout.write("\\n${resultMarker}" + JSON.stringify(results) + "\\n");
`;

function loadWithoutReact(entries) {
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", loadEntries], {
    encoding: "utf8",
    env: {
      ...process.env,
      FARM_REACT_FREE_ENTRIES: JSON.stringify(
        entries.map((entry) => ({
          specifier: entry.specifier,
          url: pathToFileURL(entry.file).href,
        })),
      ),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const line = output.split("\n").find((candidate) => candidate.startsWith(resultMarker));
  assert.ok(line, `The loader printed no results:\n${output}`);
  return JSON.parse(line.slice(resultMarker.length));
}

test("integration server entries load without React installed", () => {
  const packages = integrationPackages();
  // Guards discovery itself: an empty roster would pass vacuously.
  for (const name of ["@farm.js/unkey", "@farm.js/stripe", "@farm.js/ai", "@farm.js/agent"]) {
    assert.ok(
      packages.some((pkg) => pkg.name === name),
      `${name} was not found as an integration package`,
    );
  }

  const entries = packages.flatMap(serverEntries);
  const unbuilt = entries.filter((entry) => !fs.existsSync(entry.file));
  assert.deepEqual(
    unbuilt.map((entry) => `${entry.specifier} -> ${path.relative(process.cwd(), entry.file)}`),
    [],
    "Build the workspace first (pnpm build).",
  );

  const core = readPublicPackages().find((pkg) => pkg.name === "@farm.js/core");
  const control = {
    specifier: "@farm.js/core",
    file: path.resolve(core.dir, exportTarget(core.manifest.exports["."], "import")),
  };
  const [rootResult, ...results] = loadWithoutReact([control, ...entries]);

  // The core root still loads Farm's React client, so this proves React is actually refused.
  assert.match(rootResult.error ?? "", /Cannot find package 'react/);

  const failures = results
    .filter((result) => result.error)
    .map((result) => `${result.specifier}: ${result.error}`);
  assert.deepEqual(failures, [], failures.join("\n"));
});
