const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

// Every pnpm scaffold command in docs, READMEs, templates, UI, and skills uses the plain stable
// form. Config prefixes and dist-tags drifted across copies during the beta, so pin the one form.
const canonical = /(?:^|[^\w-])pnpm create @farm\.js\/app(?![@\w])/;

function scaffoldLines() {
  const output = execFileSync(
    "git",
    [
      "grep",
      "-nIE",
      "pnpm( [^ ]+)* create @farm\\.js/app|pnpm dlx @farm\\.js/create-app",
      "--",
      ".",
      ":!**/CHANGELOG.md",
      ":!scripts/scaffold-command.test.js",
    ],
    { cwd: root, encoding: "utf8" },
  );
  return output.trim().split("\n").filter(Boolean);
}

test("pnpm scaffold commands use the plain stable command", () => {
  const lines = scaffoldLines();
  assert.ok(
    lines.length > 20,
    `expected the pnpm scaffold commands to be found, got ${lines.length}`,
  );

  const offending = lines.filter(
    (line) =>
      !canonical.test(line) ||
      /pnpm (?:--config\S*\s+)+create|PNPM_CONFIG_\w+=\S+\s+pnpm create|pnpm dlx @farm\.js/.test(
        line,
      ),
  );
  assert.deepEqual(offending, [], "use `pnpm create @farm.js/app` without config flags or a tag");
});
