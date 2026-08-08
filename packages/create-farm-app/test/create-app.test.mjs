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
      generatedPackage.dependencies["@fontsource-variable/geist"],
      templatePackage.dependencies["@fontsource-variable/geist"],
    );
    assert.equal(
      generatedPackage.dependencies["@fontsource-variable/geist-mono"],
      templatePackage.dependencies["@fontsource-variable/geist-mono"],
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
    assert.doesNotMatch(generatedHomePage, /from "@farm\.js\/core\/version"/);
    assert.match(generatedHomePage, /Edit <code>page\.tsx<\/code> to begin/);
    assert.match(generatedHomePage, /<code>page\.tsx<\/code>/);
    assert.match(generatedHomePage, /FARMJS \/ Basic starter/);
    assert.match(generatedHomePage, /className="command-list"/);
    assert.match(generatedHomePage, /className="resource-links"/);
    assert.doesNotMatch(generatedHomePage, /<header/);
    assert.doesNotMatch(generatedHomePage, /hero-description/);
    assert.doesNotMatch(generatedHomePage, /from "farm\//);

    const generatedResourceLinks = await readFile(
      path.join(tempDir, "generated-app/src/components/resource-links.tsx"),
      "utf8",
    );
    assert.match(generatedResourceLinks, /function DocsIcon\(\)/);
    assert.match(generatedResourceLinks, /function GitHubIcon\(\)/);
    assert.match(generatedResourceLinks, /function ResourceSeparator\(\)/);
    assert.match(generatedResourceLinks, /className="resource-separator"/);
    assert.match(generatedResourceLinks, /aria-hidden="true"/);
    assert.doesNotMatch(generatedResourceLinks, /Docs ↗|GitHub ↗/);

    const generatedStyles = await readFile(
      path.join(tempDir, "generated-app/src/app/globals.css"),
      "utf8",
    );
    assert.match(generatedStyles, /@fontsource-variable\/geist\/wght\.css/);
    assert.match(generatedStyles, /@fontsource-variable\/geist-mono\/wght\.css/);
    assert.match(generatedStyles, /--paper: #000000/);
    assert.match(generatedStyles, /align-items: center/);
    assert.match(generatedStyles, /justify-content: flex-start/);
    assert.match(generatedStyles, /\.resource-icon/);
    assert.doesNotMatch(generatedStyles, /background-image:/);

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
    assert.match(generatedPnpmWorkspace, /^packages:\n  - "\."$/m);
    assert.match(generatedPnpmWorkspace, /^allowBuilds:$/m);
    assert.match(generatedPnpmWorkspace, /^  "@prisma\/client": true$/m);
    assert.match(generatedPnpmWorkspace, /^  esbuild: true$/m);
    assert.match(generatedPnpmWorkspace, /^  sharp: true$/m);
    assert.match(generatedPnpmWorkspace, /^  vue-demi: true$/m);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

for (const template of [
  {
    name: "auth",
    dependency: "@farm.js/auth",
    homePagePattern: /auth\.session\(\)/,
    brandPattern: /FARMJS \/ Auth starter/,
    instructionPattern: /FARMJS Auth uses local SQLite automatically/,
    betterCall: "1.3.2",
    workspacePackage: "@farm.js/auth",
  },
  {
    name: "better-auth",
    dependency: "@farm.js/better-auth",
    homePagePattern: /getServerSession\(\)/,
    brandPattern: /FARMJS \/ Better Auth starter/,
    instructionPattern: /copy \.env\.example to \.env\.local/,
    betterCall: "1.3.7",
    workspacePackage: "@farm.js/better-auth",
  },
]) {
  test(`generates the ${template.name} starter with setup guidance`, async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), `create-farm-app-${template.name}-`));

    try {
      const output = execFileSync(
        process.execPath,
        [
          path.join(packageDir, "bin/create-farm-app.js"),
          "generated-app",
          "--template",
          template.name,
          "--typescript",
          "--skip-install",
        ],
        {
          cwd: tempDir,
          encoding: "utf8",
          env: {
            ...process.env,
            npm_config_user_agent: "pnpm/11.18.0 npm/? node/v22.0.0",
          },
        },
      );

      const templateDir = path.join(packageDir, "templates", template.name);
      const generatedDir = path.join(tempDir, "generated-app");
      const templatePackage = JSON.parse(
        await readFile(path.join(templateDir, "package.json"), "utf8"),
      );
      const generatedPackage = JSON.parse(
        await readFile(path.join(generatedDir, "package.json"), "utf8"),
      );

      assert.equal(generatedPackage.name, "generated-app");
      assert.equal(generatedPackage.packageManager, "pnpm@11.18.0");
      assert.equal(
        generatedPackage.dependencies[template.dependency],
        templatePackage.dependencies[template.dependency],
      );
      assert.equal(
        generatedPackage.dependencies["@farm.js/core"],
        templatePackage.dependencies["@farm.js/core"],
      );
      assert.equal(
        generatedPackage.dependencies["@fontsource-variable/geist"],
        templatePackage.dependencies["@fontsource-variable/geist"],
      );
      assert.equal(
        generatedPackage.dependencies["@fontsource-variable/geist-mono"],
        templatePackage.dependencies["@fontsource-variable/geist-mono"],
      );
      assert.equal(generatedPackage.dependencies["better-call"], template.betterCall);
      assert.equal(
        generatedPackage.devDependencies["@farm.js/cli"],
        templatePackage.devDependencies["@farm.js/cli"],
      );

      const generatedHomePage = await readFile(path.join(generatedDir, "src/app/page.tsx"), "utf8");
      assert.match(generatedHomePage, template.homePagePattern);
      assert.match(generatedHomePage, template.brandPattern);
      assert.match(generatedHomePage, /className="hero-section"/);
      assert.match(generatedHomePage, /className="command-list"/);
      assert.match(generatedHomePage, /className="resource-links"/);
      assert.doesNotMatch(generatedHomePage, /SiteHeader/);
      assert.doesNotMatch(generatedHomePage, /hero-description/);
      assert.doesNotMatch(generatedHomePage, /className="flow-section"/);

      const generatedResourceLinks = await readFile(
        path.join(generatedDir, "src/components/resource-links.tsx"),
        "utf8",
      );
      assert.match(generatedResourceLinks, /function DocsIcon\(\)/);
      assert.match(generatedResourceLinks, /function GitHubIcon\(\)/);
      assert.match(generatedResourceLinks, /function ResourceSeparator\(\)/);
      assert.match(generatedResourceLinks, /className="resource-separator"/);
      assert.match(generatedResourceLinks, /aria-hidden="true"/);
      assert.doesNotMatch(generatedResourceLinks, /Docs ↗|GitHub ↗/);

      const generatedStyles = await readFile(
        path.join(generatedDir, "src/app/globals.css"),
        "utf8",
      );
      assert.match(generatedStyles, /@fontsource-variable\/geist\/wght\.css/);
      assert.match(generatedStyles, /@fontsource-variable\/geist-mono\/wght\.css/);
      assert.match(generatedStyles, /background: rgb\(255 255 255 \/ 0\.025\)/);
      assert.match(generatedStyles, /align-items: center/);
      assert.match(generatedStyles, /justify-content: flex-start/);
      assert.match(generatedStyles, /\.resource-icon/);
      assert.doesNotMatch(generatedStyles, /background-image:/);

      const generatedAuthShell = await readFile(
        path.join(generatedDir, "src/components/auth-shell.tsx"),
        "utf8",
      );
      assert.match(generatedAuthShell, /className="auth-home-link"/);
      assert.match(generatedAuthShell, /className="auth-resource-links"/);
      assert.match(generatedAuthShell, template.brandPattern);
      assert.doesNotMatch(generatedAuthShell, /auth-context/);

      const generatedAuthForm = await readFile(
        path.join(generatedDir, "src/components/auth-form.tsx"),
        "utf8",
      );
      assert.match(generatedAuthForm, /01 \/ SIGN UP/);
      assert.match(generatedAuthForm, /Create account\./);
      assert.doesNotMatch(generatedAuthForm, /Add social providers/);

      const generatedWorkspace = await readFile(
        path.join(generatedDir, "pnpm-workspace.yaml"),
        "utf8",
      );
      assert.match(generatedWorkspace, /^packages:\n  - "\."$/m);
      assert.match(generatedWorkspace, /^allowBuilds:$/m);
      assert.match(generatedWorkspace, /^minimumReleaseAgeExclude:$/m);
      assert.match(
        generatedWorkspace,
        new RegExp(
          `^  - "${template.workspacePackage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"$`,
          "m",
        ),
      );

      const generatedGitignore = await readFile(path.join(generatedDir, ".gitignore"), "utf8");
      assert.match(generatedGitignore, /^\.env\.local$/m);
      await readFile(path.join(generatedDir, ".env.example"), "utf8");
      const generatedReadme = await readFile(path.join(generatedDir, "README.md"), "utf8");
      assert.match(generatedReadme, /^# FARMJS /);

      assert.match(output, /Create FARMJS App/);
      assert.match(output, template.instructionPattern);
      assert.match(output, /pnpm install/);
      assert.match(output, /pnpm dev/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
}

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
