import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { FarmGeneratedArtifactsStaleError, generateFarmArtifacts } = require("../dist/index.js");

test("checks committed generated types without rewriting stale output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-generate-check-"));
  const apiDirectory = path.join(root, "src/app/api/health");
  await mkdir(apiDirectory, { recursive: true });
  await writeFile(path.join(root, "farm.config.mjs"), "export default {};\n");
  await writeFile(
    path.join(apiDirectory, "route.ts"),
    "export const GET = async () => Response.json({ ok: true });\n",
  );

  try {
    await generateFarmArtifacts({ root });
    await generateFarmArtifacts({ root, check: true });

    const apiTypesPath = path.join(root, "src/lib/api.generated.ts");
    await writeFile(apiTypesPath, "// stale\n");

    await assert.rejects(
      () => generateFarmArtifacts({ root, check: true }),
      (error) => {
        assert.ok(error instanceof FarmGeneratedArtifactsStaleError);
        assert.deepEqual(error.stalePaths, [apiTypesPath]);
        assert.match(error.message, /Run farm generate/);
        return true;
      },
    );
    assert.equal(await readFile(apiTypesPath, "utf8"), "// stale\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
