const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const betaPackagePattern = ["@farm\\.js/", "(app|create-app)", "@beta"].join("");
const betaPackage = /@farm\.js\/(?:app|create-app)@beta/;

test("pnpm beta scaffold commands bypass stale metadata and release-age filters", () => {
  const files = execFileSync("git", ["grep", "-IlE", betaPackagePattern, "--", "."], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);

  const pnpmCommands = files.flatMap((file) =>
    fs
      .readFileSync(path.join(root, file), "utf8")
      .split("\n")
      .map((line, index) => ({ file, line, lineNumber: index + 1 }))
      .filter(({ line }) => line.includes("pnpm") && betaPackage.test(line)),
  );

  assert.ok(pnpmCommands.length > 0, "expected at least one pnpm beta scaffold command");

  for (const { file, line, lineNumber } of pnpmCommands) {
    assert.match(
      line,
      /--config\.dlx-cache-max-age=0/,
      `${file}:${lineNumber} must refresh the pnpm create/dlx metadata cache`,
    );
    assert.match(
      line,
      /--config\.minimum-release-age=0/,
      `${file}:${lineNumber} must allow a newly published beta`,
    );
  }
});
