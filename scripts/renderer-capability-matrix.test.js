const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const repositoryRoot = path.resolve(__dirname, "..");
const docsPath = path.join(repositoryRoot, "docs", "src", "app", "docs", "renderers", "page.md");
const matrixStart = "<!-- renderer-capability-matrix:start -->";
const matrixEnd = "<!-- renderer-capability-matrix:end -->";

const renderers = [
  {
    label: "React",
    descriptorPath: "packages/farm/src/renderer.ts",
    descriptorExport: "REACT_RENDERER",
    serverPath: "packages/farm/src/renderer/react/server.ts",
    clientPath: "packages/farm/src/renderer/react/client.ts",
  },
  {
    label: "Preact",
    descriptorPath: "packages/farm-preact/src/index.ts",
    descriptorExport: "PREACT_RENDERER",
    serverPath: "packages/farm-preact/src/server.ts",
    clientPath: "packages/farm-preact/src/client.ts",
  },
  {
    label: "Solid",
    descriptorPath: "packages/farm-solid/src/index.ts",
    descriptorExport: "SOLID_RENDERER",
    serverPath: "packages/farm-solid/src/server.ts",
    clientPath: "packages/farm-solid/src/client.ts",
  },
  {
    label: "Vue",
    descriptorPath: "packages/farm-vue/src/index.ts",
    descriptorExport: "VUE_RENDERER",
    serverPath: "packages/farm-vue/src/server.ts",
    clientPath: "packages/farm-vue/src/client.ts",
  },
  {
    label: "Svelte",
    descriptorPath: "packages/farm-svelte/src/index.ts",
    descriptorExport: "SVELTE_RENDERER",
    serverPath: "packages/farm-svelte/src/server.ts",
    clientPath: "packages/farm-svelte/src/client.ts",
  },
];

function absolutePath(relativePath) {
  return path.join(repositoryRoot, relativePath);
}

async function loadTypeScriptModule(relativePath) {
  const source = fs.readFileSync(absolutePath(relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: relativePath,
  }).outputText;
  const sourceUrl = `farm-renderer-matrix/${relativePath.replaceAll("\\", "/")}`;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(
    `${compiled}\n//# sourceURL=${sourceUrl}`,
  ).toString("base64")}`;
  return import(moduleUrl);
}

async function loadDescriptor(relativePath, exportName) {
  const loaded = await loadTypeScriptModule(relativePath);
  const descriptor = loaded[exportName];
  assert.ok(descriptor, `${relativePath} does not export ${exportName}`);
  return descriptor;
}

function exportedNames(relativePath) {
  const source = fs.readFileSync(absolutePath(relativePath), "utf8");
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set();

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      for (const element of statement.exportClause.elements) names.add(element.name.text);
      continue;
    }
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) continue;
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }

  return names;
}

function streamingLabel(renderer, streaming = {}) {
  if (streaming.node && streaming.web) return "Node + Web";
  if (streaming.node) return "Node";
  if (streaming.web) return "Web";
  const serverTestPath = renderer.serverPath.replace(
    "/src/server.ts",
    "/src/__tests__/renderer.test.ts",
  );
  return `Buffered ([test](https://github.com/farming-labs/farm.js/blob/main/${serverTestPath}))`;
}

function code(value) {
  return `\`${value}\``;
}

function normalizeMarkdownTables(value) {
  return value
    .split("\n")
    .map((line) =>
      line.startsWith("|")
        ? `| ${line
            .slice(1, -1)
            .split("|")
            .map((cell) => {
              const trimmed = cell.trim();
              return /^-+$/.test(trimmed) ? "---" : trimmed;
            })
            .join(" | ")} |`
        : line.trim(),
    )
    .join("\n");
}

async function generateMatrix() {
  const coreRenderer = await loadTypeScriptModule("packages/farm/src/renderer.ts");
  const rows = await Promise.all(
    renderers.map(async (renderer) => {
      const descriptor = await loadDescriptor(renderer.descriptorPath, renderer.descriptorExport);
      const serverExports = exportedNames(renderer.serverPath);
      const clientExports = exportedNames(renderer.clientPath);
      return { renderer, descriptor, serverExports, clientExports };
    }),
  );

  const entryTable = [
    "| Renderer | Vite entry | Server entry | Client entry | Route module extensions |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(({ renderer, descriptor }) => {
      const extensions = coreRenderer.getFarmRendererComponentExtensions(descriptor);
      return `| ${renderer.label} | ${code(descriptor.vite)} | ${code(descriptor.server)} | ${code(descriptor.client)} | ${extensions.map(code).join(", ")} |`;
    }),
  ];

  const capabilityTable = [
    "| Renderer | SSR | Streaming | Hydration | Component head output | Route updates | Plain functions |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(({ renderer, descriptor, serverExports, clientExports }) => {
      const capabilities = coreRenderer.getFarmRendererCapabilities(descriptor);
      const headOutput = serverExports.has("renderToStringWithHead")
        ? "Native + framework"
        : "Framework metadata";
      const routeUpdates = capabilities.reconcilesRerenders
        ? "Reconciles"
        : "Remounts ([why](#re-render-behavior))";
      return `| ${renderer.label} | ${serverExports.has("renderToString") ? "Yes" : "No"} | ${streamingLabel(renderer, capabilities.streaming)} | ${clientExports.has("hydrateRoot") ? "Yes" : "No"} | ${headOutput} | ${routeUpdates} | ${capabilities.functionComponents ? "Yes" : "No"} |`;
    }),
  ];

  return [...entryTable, "", ...capabilityTable].join("\n");
}

test("renderer capability matrix matches descriptors and runtime exports", async () => {
  const docs = fs.readFileSync(docsPath, "utf8");
  const start = docs.indexOf(matrixStart);
  const end = docs.indexOf(matrixEnd);
  assert.notEqual(
    start,
    -1,
    `Missing ${matrixStart} in ${path.relative(repositoryRoot, docsPath)}`,
  );
  assert.notEqual(end, -1, `Missing ${matrixEnd} in ${path.relative(repositoryRoot, docsPath)}`);
  assert.ok(end > start, "Renderer capability matrix markers are out of order");

  const documented = docs.slice(start + matrixStart.length, end).trim();
  assert.equal(
    normalizeMarkdownTables(documented),
    normalizeMarkdownTables(await generateMatrix()),
    "Renderer capability matrix is stale; update it to match the descriptors and runtime exports.",
  );
});
