import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("generates a buildable starter dependency manifest", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "create-farm-app-"));

  try {
    execFileSync(
      process.execPath,
      [
        path.join(packageDir, "bin/create-farm-app.js"),
        "generated-app",
        "--template",
        "basic",
        "--typescript",
      ],
      {
        cwd: tempDir,
        stdio: "pipe",
      },
    );

    const templatePackage = JSON.parse(
      await readFile(path.join(packageDir, "templates/basic/package.json"), "utf8"),
    );
    const generatedPackage = JSON.parse(
      await readFile(path.join(tempDir, "generated-app/package.json"), "utf8"),
    );

    assert.equal(generatedPackage.name, "generated-app");
    assert.equal(generatedPackage.packageManager, templatePackage.packageManager);
    assert.equal(
      generatedPackage.dependencies["@farm.js/core"],
      templatePackage.dependencies["@farm.js/core"],
    );
    assert.equal(
      generatedPackage.devDependencies["@farm.js/cli"],
      templatePackage.devDependencies["@farm.js/cli"],
    );
    assert.equal(
      generatedPackage.devDependencies.tailwindcss,
      templatePackage.devDependencies.tailwindcss,
    );

    const generatedHomePage = await readFile(
      path.join(tempDir, "generated-app/src/app/page.tsx"),
      "utf8",
    );
    assert.match(generatedHomePage, /from "@farm\.js\/core\/client"/);
    assert.doesNotMatch(generatedHomePage, /from "farm\//);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
