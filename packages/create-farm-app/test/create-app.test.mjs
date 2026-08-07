import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("generates a buildable starter application", async () => {
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
        "--skip-install",
      ],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          npm_config_user_agent: "pnpm/10.15.0 npm/? node/v22.0.0",
        },
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
    assert.equal(generatedPackage.packageManager, "pnpm@10.15.0");
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
    assert.equal(generatedPackage.dependencies.react, templatePackage.dependencies.react);
    assert.equal(
      generatedPackage.dependencies["react-dom"],
      templatePackage.dependencies["react-dom"],
    );
    assert.equal(
      generatedPackage.devDependencies["@types/react"],
      templatePackage.devDependencies["@types/react"],
    );
    assert.equal(
      generatedPackage.devDependencies["@types/react-dom"],
      templatePackage.devDependencies["@types/react-dom"],
    );

    const generatedHomePage = await readFile(
      path.join(tempDir, "generated-app/src/app/page.tsx"),
      "utf8",
    );
    assert.match(generatedHomePage, /from "@farm\.js\/core\/client"/);
    assert.match(generatedHomePage, /from "@farm\.js\/core\/version"/);
    assert.match(generatedHomePage, /Welcome to Farm\.js v\{FARM_VERSION\}/);
    assert.doesNotMatch(generatedHomePage, /Welcome to Farm\.js v?\d+\.\d+\.\d+/);
    assert.doesNotMatch(generatedHomePage, /from "farm\//);

    const generatedLayout = await readFile(
      path.join(tempDir, "generated-app/src/app/layout.tsx"),
      "utf8",
    );
    assert.match(generatedLayout, /url: "\/favicon\.svg"/);
    assert.match(generatedLayout, /type: "image\/svg\+xml"/);

    const generatedFavicon = await readFile(
      path.join(tempDir, "generated-app/public/favicon.svg"),
      "utf8",
    );
    assert.match(generatedFavicon, /<title id="title">Farming Labs<\/title>/);

    const generatedConfig = await readFile(
      path.join(tempDir, "generated-app/farm.config.ts"),
      "utf8",
    );
    assert.doesNotMatch(generatedConfig, /srcDir/);

    const generatedTsconfig = JSON.parse(
      await readFile(path.join(tempDir, "generated-app/tsconfig.json"), "utf8"),
    );
    assert.deepEqual(generatedTsconfig.compilerOptions.paths, {
      "@/*": ["./src/*"],
    });

    const generatedGitignore = await readFile(
      path.join(tempDir, "generated-app/.gitignore"),
      "utf8",
    );
    assert.match(generatedGitignore, /^\.env$/m);
    assert.match(generatedGitignore, /^\.env\.local$/m);
    assert.match(generatedGitignore, /^\*\.sqlite$/m);
    assert.match(generatedGitignore, /^\*\.sqlite-\*$/m);

    const templatePnpmWorkspace = await readFile(
      path.join(packageDir, "templates/basic/pnpm-workspace.yaml"),
      "utf8",
    );
    const generatedPnpmWorkspace = await readFile(
      path.join(tempDir, "generated-app/pnpm-workspace.yaml"),
      "utf8",
    );
    assert.equal(generatedPnpmWorkspace, templatePnpmWorkspace);
    assert.match(generatedPnpmWorkspace, /^allowBuilds:$/m);
    assert.match(generatedPnpmWorkspace, /^  "@prisma\/client": true$/m);
    assert.match(generatedPnpmWorkspace, /^  esbuild: true$/m);
    assert.match(generatedPnpmWorkspace, /^  sharp: true$/m);
    assert.match(generatedPnpmWorkspace, /^  vue-demi: true$/m);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("installs dependencies with the invoking package manager", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "create-farm-app-install-"));
  const binDir = path.join(tempDir, "bin");
  const markerPath = path.join(tempDir, "install.json");
  const runnerPath = path.join(binDir, "fake-package-manager.cjs");
  const executablePath = path.join(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm");

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      runnerPath,
      `const { writeFileSync } = require("node:fs");
writeFileSync(process.env.FARM_CREATE_APP_INSTALL_MARKER, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
}));
`,
    );

    if (process.platform === "win32") {
      await writeFile(executablePath, `@"${process.execPath}" "${runnerPath}" %*\r\n`);
    } else {
      await writeFile(
        executablePath,
        `#!/bin/sh\nexec "${process.execPath}" "${runnerPath}" "$@"\n`,
      );
      await chmod(executablePath, 0o755);
    }

    const output = execFileSync(
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
        encoding: "utf8",
        env: {
          ...process.env,
          FARM_CREATE_APP_INSTALL_MARKER: markerPath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
          npm_config_user_agent: "pnpm/10.15.0 npm/? node/v22.0.0",
        },
      },
    );

    const invocation = JSON.parse(await readFile(markerPath, "utf8"));
    const generatedPackage = JSON.parse(
      await readFile(path.join(tempDir, "generated-app/package.json"), "utf8"),
    );

    assert.deepEqual(invocation.args, ["install"]);
    assert.equal(
      await realpath(invocation.cwd),
      await realpath(path.join(tempDir, "generated-app")),
    );
    assert.equal(generatedPackage.packageManager, "pnpm@10.15.0");
    assert.match(output, /Installing dependencies with pnpm/);
    assert.match(output, /Dependencies installed/);
    assert.match(output, /pnpm dev/);
    assert.doesNotMatch(output, /pnpm install/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
