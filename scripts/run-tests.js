#!/usr/bin/env node
/**
 * Run all tests from root and write output to test-run.log.
 * Usage: pnpm run test:ci  (or node scripts/run-tests.js from repo root)
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const logPath = path.join(root, "test-run.log");
const log = fs.createWriteStream(logPath, { flags: "w" });
log.write(`Test run started at ${new Date().toISOString()}\n`);
log.write(`cwd: ${root}\n\n`);

function write(msg) {
  try {
    log.write(msg);
  } catch (_) {}
  process.stdout.write(msg);
}

function finish(code) {
  const msg = `\nExit code: ${code}\n`;
  try {
    log.write(msg);
  } catch (_) {}
  process.stdout.write(msg);
  log.end();
  process.exit(code ?? 0);
}

const child = spawn("pnpm", ["exec", "turbo", "run", "test", "--no-cache"], {
  cwd: root,
  shell: true,
  stdio: ["inherit", "pipe", "pipe"],
});

child.stdout.on("data", (data) => write(data.toString()));
child.stderr.on("data", (data) => write(data.toString()));

child.on("close", (code) => finish(code ?? 0));
child.on("error", () => finish(1));
