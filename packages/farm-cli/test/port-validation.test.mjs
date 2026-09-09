import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

test("farm dev rejects partially numeric ports", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [cliBin, "dev", "--port", "3000oops"], {
      env: { ...process.env, FARM_TELEMETRY_DISABLED: "1" },
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /--port must be an integer between 1 and 65535/);
      return true;
    },
  );
});
