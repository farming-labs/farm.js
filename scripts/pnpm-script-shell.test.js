const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

/**
 * Runs a package script through pnpm inside a throwaway package that carries
 * the repository's .npmrc, so the test exercises the same script shell the
 * workspace uses rather than whatever the host shell happens to be.
 */
function runScript(script, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "farm-script-shell-"));
  try {
    fs.copyFileSync(path.join(repoRoot, ".npmrc"), path.join(dir, ".npmrc"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "script-shell-probe", private: true, scripts: { probe: script } }),
    );
    const childEnv = { ...process.env, ...env };
    // A caller passes `undefined` to leave the variable unset rather than empty.
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete childEnv[key];
    const result = spawnSync("pnpm", ["run", "--silent", "probe"], {
      cwd: dir,
      env: childEnv,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const PRINT = 'node -e "process.stdout.write(String(process.env.PROBE_VAR))"';

test("an inline environment prefix reaches the command", () => {
  const result = runScript(`PROBE_VAR=inline ${PRINT}`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "inline");
});

test("a ${VAR:-default} expansion falls back when the variable is unset", () => {
  // The emulator applies the default for an unset variable only; unlike bash it
  // leaves an empty string alone. The repository relies on the unset case.
  const result = runScript(`PROBE_VAR=\${PROBE_VAR:-fallback} ${PRINT}`, { PROBE_VAR: undefined });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "fallback");
});

test("a ${VAR:-default} expansion keeps an explicit value", () => {
  const result = runScript(`PROBE_VAR=\${PROBE_VAR:-fallback} ${PRINT}`, { PROBE_VAR: "explicit" });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "explicit");
});
