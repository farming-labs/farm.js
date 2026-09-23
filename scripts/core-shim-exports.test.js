const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const packagesRoot = path.join(root, "packages");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    if (!/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) return [];
    if (entry.name.includes(".test.") || entry.name.includes(".spec.")) return [];
    return [entryPath];
  });
}

function rootImports(source) {
  const names = [];
  const importPattern = /^\s*import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']@farm\.js\/core["']/gm;
  for (const match of source.matchAll(importPattern)) {
    for (const specifier of match[1].split(",")) {
      const name = specifier
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function shimExports(source) {
  const names = new Set();
  const declarationPattern =
    /\bexport\s+(?:type\s+)?(?:function|const|interface|class|type)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(declarationPattern)) names.add(match[1]);

  const exportListPattern = /\bexport\s*\{([^}]+)\}/g;
  for (const match of source.matchAll(exportListPattern)) {
    for (const specifier of match[1].split(",")) {
      const name = specifier
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      if (name) names.add(name);
    }
  }
  return names;
}

function packageDirectoriesWithShims() {
  return fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesRoot, entry.name))
    .filter((directory) => fs.existsSync(path.join(directory, "src", "farm-core-shim.d.ts")));
}

test("package root-core imports are represented by their declaration shim", () => {
  const failures = [];

  for (const packageDirectory of packageDirectoriesWithShims()) {
    const shimPath = path.join(packageDirectory, "src", "farm-core-shim.d.ts");
    const exports = shimExports(fs.readFileSync(shimPath, "utf8"));
    for (const sourcePath of sourceFiles(path.join(packageDirectory, "src"))) {
      for (const name of rootImports(fs.readFileSync(sourcePath, "utf8"))) {
        if (!exports.has(name)) {
          failures.push(
            `${path.relative(root, sourcePath)} imports ${name}, missing from ${path.relative(root, shimPath)}`,
          );
        }
      }
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
});
