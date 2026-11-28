import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/farm.js", import.meta.url));

test("agents discover installed commands and options without loading the app", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "farm-command-catalog-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(path.join(cwd, "farm.config.ts"), 'throw new Error("config was loaded");');
  const run = (...args) =>
    execFileSync(process.execPath, [bin, "agent", "commands", ...args], { cwd, encoding: "utf8" });

  const { schemaVersion, cliVersion, commands } = JSON.parse(run("--json"));
  assert.equal(schemaVersion, 1);
  assert.match(cliVersion, /^\d+\./);
  const find = (name) => commands.find((command) => command.path.join(" ") === name);
  assert.ok(find("doctor").options.some((option) => option.long === "--json"));
  assert.ok(find("schema migrate").options.some((option) => option.long === "--apply"));
  assert.ok(find("add integration").aliases.includes("integrations"));
  assert.deepEqual(find("explain").arguments, [{ name: "path", required: true, variadic: false }]);
  assert.equal(find("agent check").arguments[0].required, false);
  assert.equal(find("dev").options.find((option) => option.short === "-H").value, "optional");
  assert.equal(find("dev").options.find((option) => option.short === "-p").value, "required");
  assert.match(run(), /farm schema migrate/);
});
