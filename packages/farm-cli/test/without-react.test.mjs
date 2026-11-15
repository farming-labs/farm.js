import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "../bin/farm.js");

// Vue, Svelte, Solid and Preact apps don't install React (core only lists it as an optional
// peer), so a command that loads @farm.js/core's root entry fails there with "Cannot find
// module 'react'". This preload makes React unresolvable, like those apps.
const withoutReact = `
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (/^react(-dom)?(\\/|$)/.test(request)) {
    const error = new Error("Cannot find module '" + request + "'");
    error.code = "MODULE_NOT_FOUND";
    throw error;
  }
  return resolve.call(this, request, ...rest);
};
`;

test("the CLI's main bundle and its sign-in commands load without React", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "farm-without-react-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const preload = path.join(dir, "without-react.cjs");
  await fs.writeFile(preload, withoutReact);
  const env = {
    ...process.env,
    FARM_TELEMETRY_DISABLED: "1",
    FARM_PREVIEW_CREDENTIALS_PATH: path.join(dir, "credentials.json"),
    NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
  };

  // The preload really hides React from this process.
  await assert.rejects(
    run(process.execPath, ["-e", "require('react')"], { env }),
    /Cannot find module 'react'/,
  );
  await run(
    process.execPath,
    ["-e", "require(process.argv[1])", path.join(here, "../dist/index.js")],
    {
      env,
    },
  );

  // `farm logout` runs entirely through the main bundle and needs no network.
  const logout = await run(
    process.execPath,
    [bin, "logout", "--gateway", "https://preview.example.com"],
    {
      cwd: dir,
      env,
    },
  );
  assert.match(
    logout.stdout + logout.stderr,
    /No saved sign-in for https:\/\/preview\.example\.com/,
  );
  assert.doesNotMatch(logout.stdout + logout.stderr, /Cannot find module/);
});
