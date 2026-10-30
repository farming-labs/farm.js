const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const examplesRoot = path.resolve(__dirname, "..", "examples");

function envExampleFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") return [];
      return envExampleFiles(entryPath);
    }
    return entry.name === ".env.example" ? [entryPath] : [];
  });
}

// IDs, event names, and publishable keys are not secrets. Everything else that
// names a secret, key, token, or password ships empty: a placeholder a provider
// accepts would be used as-is once the file is copied, and every app that kept
// it could forge the others' sessions.
function isSecretKey(key) {
  if (/PUBLISHABLE|_ID$|_EVENT_NAME$/.test(key)) return false;
  return /SECRET|_KEY$|TOKEN|PASSWORD/.test(key);
}

test("example .env.example files ship no secret values", () => {
  const files = envExampleFiles(examplesRoot);
  assert.ok(files.length > 0, "expected examples/**/.env.example files");

  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=(.*)$/gm)) {
      const [, key, value] = match;
      if (isSecretKey(key) && value.trim() !== "") {
        offenders.push(`${path.relative(examplesRoot, file)}: ${key}`);
      }
    }
  }

  assert.deepEqual(offenders, [], "secret lines must be empty in .env.example");
});
