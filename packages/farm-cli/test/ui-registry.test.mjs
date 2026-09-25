import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  SHADCN_REGISTRY_ITEM_SCHEMA,
  UI_REGISTRY_ROUTE_PATTERN,
  UI_REGISTRY_URL_TEMPLATE,
  createUIRegistryItem,
  handleUIRegistryRequest,
  listUIRegistryItemNames,
  resolveUIRegistryItemName,
} = require("../dist/ui-registry.js");
const { addFarmIntegration } = require("../dist/add-integration.js");

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");

// https://ui.shadcn.com/schema/registry-item.json
const REGISTRY_TYPES = new Set([
  "registry:lib",
  "registry:block",
  "registry:component",
  "registry:ui",
  "registry:hook",
  "registry:theme",
  "registry:page",
  "registry:file",
  "registry:style",
  "registry:base",
  "registry:item",
]);

function urlForItem(name) {
  return UI_REGISTRY_URL_TEMPLATE.replace("{name}", name);
}

// The CLI resolves the `@/lib/utils` alias to a relative import as it writes a
// file into an app, while a registry item keeps the alias for the shadcn CLI to
// resolve against the consumer's components.json. Undo that one transform so the
// rest of the source can be compared byte for byte.
function withAliasImports(source) {
  return source.replace(/from "(?:\.\.\/)+lib\/utils"/g, 'from "@/lib/utils"');
}

// Stand-in for the route matcher in @farm.js/core, so this test can check that
// the advertised url lands on the pattern the docs app mounts without importing
// the framework into the CLI test run.
function matchesRoutePattern(pattern, pathname) {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return false;

  return patternSegments.every((segment, index) => {
    if (segment.startsWith("[") && segment.endsWith("]")) return pathSegments[index].length > 0;
    return segment === pathSegments[index];
  });
}

test("serves a shadcn registry item for every primitive the CLI writes", async () => {
  const names = listUIRegistryItemNames();
  assert.deepEqual([...names], ["badge", "button", "card", "input", "label"]);

  for (const name of names) {
    const response = handleUIRegistryRequest(new Request(urlForItem(name)));
    assert.equal(response.status, 200, `${name} should be served`);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");

    const item = await response.json();

    // The schema requires `name` and `type` at the top level, and `path` plus
    // `type` on every file entry.
    assert.equal(item.$schema, SHADCN_REGISTRY_ITEM_SCHEMA);
    assert.equal(item.name, name);
    assert.equal(item.type, "registry:ui");
    assert.ok(REGISTRY_TYPES.has(item.type));
    assert.equal(typeof item.title, "string");
    assert.equal(typeof item.description, "string");
    assert.ok(Array.isArray(item.files) && item.files.length > 0);

    for (const file of item.files) {
      assert.equal(typeof file.path, "string");
      assert.ok(file.path.length > 0);
      assert.ok(
        REGISTRY_TYPES.has(file.type),
        `${name} file type ${file.type} is not a registry type`,
      );
      assert.equal(typeof file.content, "string");
      assert.match(file.content, /from "@\/lib\/utils"/);
    }

    for (const dependency of item.dependencies || []) {
      assert.equal(typeof dependency, "string");
      assert.ok(dependency.length > 0);
    }
  }
});

test("declares the npm dependencies the served source imports", () => {
  for (const name of listUIRegistryItemNames()) {
    const item = createUIRegistryItem(name);
    const content = item.files[0].content;
    const declared = item.dependencies || [];

    assert.equal(
      declared.includes("class-variance-authority"),
      content.includes("class-variance-authority"),
      `${name} declares class-variance-authority without importing it, or the other way round`,
    );
  }

  assert.deepEqual(createUIRegistryItem("button").dependencies, ["class-variance-authority"]);
  assert.equal(createUIRegistryItem("label").dependencies, undefined);
});

test("only serves allowlisted item names", async () => {
  assert.equal(resolveUIRegistryItemName("/r/button.json"), "button");
  assert.equal(resolveUIRegistryItemName("/r/button"), "button");
  assert.equal(resolveUIRegistryItemName("/r/button.json?style=new-york"), "button");
  assert.equal(resolveUIRegistryItemName("/r/registry.json"), null);
  assert.equal(resolveUIRegistryItemName("/r/../../etc/passwd"), null);
  assert.equal(resolveUIRegistryItemName("/r/__proto__.json"), null);
  assert.equal(resolveUIRegistryItemName("/r/constructor"), null);

  const response = handleUIRegistryRequest(new Request("https://farmjs.dev/r/dialog.json"));
  assert.equal(response.status, 404);
  assert.deepEqual((await response.json()).items, [...listUIRegistryItemNames()]);
});

test("the advertised registry url is served by the docs app", async () => {
  // The reported bug: components.json advertised https://farmjs.dev/r/{name}.json
  // and nothing in the repo answered that path.
  const advertised = new URL(urlForItem("button"));
  assert.equal(advertised.hostname, "farmjs.dev");
  assert.ok(
    matchesRoutePattern(UI_REGISTRY_ROUTE_PATTERN, advertised.pathname),
    `${UI_REGISTRY_ROUTE_PATTERN} does not match ${advertised.pathname}`,
  );

  const routesFile = path.join(repoRoot, "docs/src/routes.ts");
  assert.ok(
    existsSync(routesFile),
    `${routesFile} is missing, so nothing serves ${UI_REGISTRY_URL_TEMPLATE}`,
  );

  const routesSource = await readFile(routesFile, "utf8");
  assert.match(routesSource, /from "@farm\.js\/cli\/ui-registry"/);
  assert.match(routesSource, /api\(UI_REGISTRY_ROUTE_PATTERN, \{/);
  assert.match(routesSource, /GET: \(request: Request\) => handleUIRegistryRequest\(request\)/);
});

test("publishes the registry entry the docs app imports", async () => {
  const manifest = JSON.parse(await readFile(path.join(testDir, "../package.json"), "utf8"));
  const entry = manifest.exports?.["./ui-registry"];

  assert.ok(
    entry,
    "@farm.js/cli does not publish ./ui-registry, so the docs import cannot resolve",
  );
  assert.equal(entry.import, "./dist/ui-registry.mjs");
  assert.equal(entry.require, "./dist/ui-registry.js");
  assert.ok(manifest.files.includes("dist"));
});

test("serves the same source the CLI writes into an app", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-ui-registry-"));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ type: "module", dependencies: { "@farm.js/core": "workspace:*" } }, null, 2),
      "utf8",
    );
    await mkdir(path.join(root, "src/app"), { recursive: true });
    await writeFile(path.join(root, "src/app/globals.css"), "body { margin: 0; }\n", "utf8");

    const result = await addFarmIntegration({ root, provider: "stripe", ui: true });
    assert.ok(result.ui.components.length > 0);

    for (const component of result.ui.components) {
      const written = await readFile(
        path.join(root, "src/components/ui", `${component}.tsx`),
        "utf8",
      );
      assert.equal(
        createUIRegistryItem(component).files[0].content,
        withAliasImports(written),
        `registry item ${component} drifted from the file the CLI writes`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
