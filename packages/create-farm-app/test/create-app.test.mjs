import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("spaces the CLI banner and matches the website hero copy", async () => {
  const { showBanner } = await import("../dist/utils.mjs");
  const lines = [];
  const originalLog = console.log;
  console.log = (...values) => lines.push(values.join(" "));

  try {
    showBanner();
  } finally {
    console.log = originalLog;
  }

  assert.equal(lines[8], "");
  assert.match(lines[9], /Create FARMJS App.*a framework for product-integrated apps/);
  assert.doesNotMatch(lines.join("\n"), /React (?:meta-)?framework/i);
});

test("uses concise labels for CLI template choices", async () => {
  const source = await readFile(path.join(packageDir, "src/index.ts"), "utf8");

  assert.match(source, /title: "Basic starter"/);
  assert.match(source, /title: "React Compiler starter \(experimental\)"/);
  assert.match(source, /title: "Auth starter"/);
  assert.match(source, /title: "Better Auth starter"/);
  assert.match(source, /title: "Stripe starter"/);
  assert.match(source, /title: "Supabase starter"/);
  assert.match(source, /title: "Trigger\.dev starter"/);
  assert.doesNotMatch(source, /title: "(?:Farm\.js|FARMJS)/);
});

test("lists every integration starter from the CLI", () => {
  const output = execFileSync(
    process.execPath,
    [path.join(packageDir, "bin/create-farm-app.js"), "--list-templates"],
    { encoding: "utf8" },
  );

  for (const template of [
    "basic",
    "react-compiler",
    "auth",
    "better-auth",
    "ai",
    "auth0",
    "authjs",
    "autumn",
    "clerk",
    "jobs-inngest",
    "jobs-trigger",
    "polar",
    "resend",
    "stripe",
    "supabase",
    "unkey",
    "workos",
  ]) {
    assert.match(output, new RegExp(`\\b${template}\\b`));
  }
});

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
    assert.match(generatedResourceLinks, /href="https:\/\/farm\.js\.dev"/);
    assert.doesNotMatch(generatedResourceLinks, /https:\/\/farmjs\.dev/);
    assert.doesNotMatch(generatedResourceLinks, /Docs ↗|GitHub ↗/);

    const generatedStyles = await readFile(
      path.join(tempDir, "generated-app/src/app/globals.css"),
      "utf8",
    );
    assert.match(generatedStyles, /@fontsource-variable\/geist\/wght\.css/);
    assert.match(generatedStyles, /@fontsource-variable\/geist-mono\/wght\.css/);
    assert.match(generatedStyles, /--paper: #000000/);
    assert.match(generatedStyles, /\.hero-section \{[^}]*min-height: 100vh/s);
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
    assert.match(generatedConfig, /theme:\s*\{\s*default: "dark"/s);

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

test("generates the experimental React Compiler starter with the shared dark starter UI", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "create-farm-app-react-compiler-"));

  try {
    const output = execFileSync(
      process.execPath,
      [
        path.join(packageDir, "bin/create-farm-app.js"),
        "compiler-app",
        "--template",
        "react-compiler",
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

    const templateDir = path.join(packageDir, "templates/react-compiler");
    const basicTemplateDir = path.join(packageDir, "templates/basic");
    const generatedDir = path.join(tempDir, "compiler-app");
    const templatePackage = JSON.parse(
      await readFile(path.join(templateDir, "package.json"), "utf8"),
    );
    const generatedPackage = JSON.parse(
      await readFile(path.join(generatedDir, "package.json"), "utf8"),
    );

    assert.equal(generatedPackage.name, "compiler-app");
    assert.equal(generatedPackage.packageManager, "pnpm@11.18.0");
    assert.equal(
      generatedPackage.dependencies["@farm.js/core"],
      templatePackage.dependencies["@farm.js/core"],
    );
    assert.equal(
      generatedPackage.dependencies["@farm.js/react"],
      templatePackage.dependencies["@farm.js/react"],
    );
    assert.equal(
      generatedPackage.devDependencies["@farm.js/cli"],
      templatePackage.devDependencies["@farm.js/cli"],
    );
    assert.equal(
      generatedPackage.scripts.experiment,
      "pnpm run build && node scripts/verify-experiment.mjs",
    );
    assert.equal(generatedPackage.scripts["experiment:heavy"], undefined);
    assert.equal(generatedPackage.devDependencies.tailwindcss, "^4.0.0");

    const config = await readFile(path.join(generatedDir, "farm.config.ts"), "utf8");
    assert.match(config, /from "@farm\.js\/react"/);
    assert.match(config, /experimental:\s*\{\s*compiler: compilerEnabled/s);
    assert.match(config, /__FARM_REACT_COMPILER_ENABLED__/);
    assert.match(config, /theme:\s*\{\s*default: "dark"/s);

    const page = await readFile(path.join(generatedDir, "src/app/page.tsx"), "utf8");
    assert.match(page, /className="landing-main"/);
    assert.match(page, /FARMJS \/ React Compiler starter/);
    assert.match(page, /The compiler handles the rest\./);
    assert.match(page, /data-compiler-status/);
    assert.match(page, /reactCompilerEnabled/);
    assert.match(page, /<CompilerComparison \/>/);
    assert.match(page, /<ResourceLinks className="resource-links" \/>/);

    const comparison = await readFile(
      path.join(generatedDir, "src/components/compiler-comparison.tsx"),
      "utf8",
    );
    assert.match(comparison, /export function CompiledCounter/);
    assert.match(comparison, /"use no compiler"/);
    assert.match(comparison, /data-path="compiled"/);
    assert.match(comparison, /data-path="react"/);

    assert.equal(
      await readFile(path.join(templateDir, "src/components/resource-links.tsx"), "utf8"),
      await readFile(path.join(basicTemplateDir, "src/components/resource-links.tsx"), "utf8"),
    );

    for (const relativePath of [
      "src/app/globals.css",
      "src/app/page.tsx",
      "src/compiler-mode.ts",
      "src/components/compiler-comparison.tsx",
      "src/components/resource-links.tsx",
    ]) {
      assert.equal(
        await readFile(path.join(generatedDir, relativePath), "utf8"),
        await readFile(path.join(templateDir, relativePath), "utf8"),
      );
    }

    assert.match(
      await readFile(path.join(generatedDir, "README.md"), "utf8"),
      /^# FARMJS React Compiler Starter/m,
    );
    await readFile(path.join(generatedDir, "scripts/verify-experiment.mjs"), "utf8");
    assert.match(await readFile(path.join(generatedDir, ".gitignore"), "utf8"), /^\.farm\/$/m);

    assert.match(output, /React AOT compiler is experimental/);
    assert.match(output, /pnpm experiment/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("generates a Solid starter while keeping React as the default renderer", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "create-farm-app-solid-"));

  try {
    execFileSync(
      process.execPath,
      [
        path.join(packageDir, "bin/create-farm-app.js"),
        "solid-app",
        "--template",
        "basic",
        "--renderer",
        "solid",
        "--typescript",
        "--skip-install",
      ],
      { cwd: tempDir, stdio: "pipe" },
    );

    const generatedDir = path.join(tempDir, "solid-app");
    const packageJson = JSON.parse(await readFile(path.join(generatedDir, "package.json"), "utf8"));
    const config = await readFile(path.join(generatedDir, "farm.config.ts"), "utf8");
    const page = await readFile(path.join(generatedDir, "src/app/page.tsx"), "utf8");
    const apiRoute = await readFile(
      path.join(generatedDir, "src/app/api/greeting/route.ts"),
      "utf8",
    );
    const apiClient = await readFile(path.join(generatedDir, "src/lib/api-client.ts"), "utf8");
    const tsconfig = JSON.parse(await readFile(path.join(generatedDir, "tsconfig.json"), "utf8"));

    assert.equal(packageJson.dependencies["@farm.js/solid"], "0.1.0-beta.26");
    assert.equal(packageJson.dependencies["solid-js"], "1.9.14");
    assert.equal(packageJson.dependencies.react, undefined);
    assert.equal(packageJson.dependencies["react-dom"], undefined);
    assert.match(config, /renderer: solid\(\)/);
    assert.match(config, /from "@farm\.js\/solid"/);
    assert.match(page, /createSignal/);
    assert.match(page, /api\.greeting\.post/);
    assert.match(apiRoute, /createEndpoint/);
    assert.match(apiRoute, /FARMJS server/);
    assert.match(apiClient, /createAPIClient<APIRouter>/);
    assert.equal(tsconfig.compilerOptions.jsx, "preserve");
    assert.equal(tsconfig.compilerOptions.jsxImportSource, "solid-js");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("generates a Preact starter with typed server interaction", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "create-farm-app-preact-"));

  try {
    execFileSync(
      process.execPath,
      [
        path.join(packageDir, "bin/create-farm-app.js"),
        "preact-app",
        "--template",
        "basic",
        "--renderer",
        "preact",
        "--typescript",
        "--skip-install",
      ],
      { cwd: tempDir, stdio: "pipe" },
    );

    const generatedDir = path.join(tempDir, "preact-app");
    const packageJson = JSON.parse(await readFile(path.join(generatedDir, "package.json"), "utf8"));
    const config = await readFile(path.join(generatedDir, "farm.config.ts"), "utf8");
    const page = await readFile(path.join(generatedDir, "src/app/page.tsx"), "utf8");
    const apiRoute = await readFile(
      path.join(generatedDir, "src/app/api/greeting/route.ts"),
      "utf8",
    );
    const apiClient = await readFile(path.join(generatedDir, "src/lib/api-client.ts"), "utf8");
    const tsconfig = JSON.parse(await readFile(path.join(generatedDir, "tsconfig.json"), "utf8"));
    const rendererPackage = JSON.parse(
      await readFile(path.join(packageDir, "..", "farm-preact", "package.json"), "utf8"),
    );

    assert.equal(packageJson.dependencies["@farm.js/preact"], rendererPackage.version);
    assert.equal(packageJson.dependencies.preact, "10.29.8");
    assert.equal(packageJson.dependencies.react, undefined);
    assert.equal(packageJson.dependencies["react-dom"], undefined);
    assert.match(config, /renderer: preact\(\)/);
    assert.match(config, /from "@farm\.js\/preact"/);
    assert.match(page, /useState/);
    assert.match(page, /api\.greeting\.post/);
    assert.match(page, /Edit <code>page\.tsx<\/code>/);
    assert.match(apiRoute, /createEndpoint/);
    assert.match(apiRoute, /FARMJS server/);
    assert.match(apiClient, /createAPIClient<APIRouter>/);
    assert.equal(tsconfig.compilerOptions.jsx, "react-jsx");
    assert.equal(tsconfig.compilerOptions.jsxImportSource, "preact");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("generates a Vue SFC starter with typed server interaction", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "create-farm-app-vue-"));

  try {
    execFileSync(
      process.execPath,
      [
        path.join(packageDir, "bin/create-farm-app.js"),
        "vue-app",
        "--template",
        "basic",
        "--renderer",
        "vue",
        "--typescript",
        "--skip-install",
      ],
      { cwd: tempDir, stdio: "pipe" },
    );

    const generatedDir = path.join(tempDir, "vue-app");
    const packageJson = JSON.parse(await readFile(path.join(generatedDir, "package.json"), "utf8"));
    const config = await readFile(path.join(generatedDir, "farm.config.ts"), "utf8");
    const page = await readFile(path.join(generatedDir, "src/app/page.vue"), "utf8");
    const layout = await readFile(path.join(generatedDir, "src/app/layout.vue"), "utf8");
    const tsconfig = JSON.parse(await readFile(path.join(generatedDir, "tsconfig.json"), "utf8"));

    assert.equal(packageJson.dependencies["@farm.js/vue"], "0.1.0-beta.26");
    assert.equal(packageJson.dependencies.vue, "3.5.41");
    assert.equal(packageJson.dependencies.react, undefined);
    assert.equal(packageJson.dependencies["react-dom"], undefined);
    assert.equal(packageJson.scripts["type-check"], "vue-tsc --noEmit");
    assert.match(config, /renderer: vue\(\)/);
    assert.match(config, /from "@farm\.js\/vue"/);
    assert.match(page, /export const hydrate = true/);
    assert.match(page, /api\.greeting\.post/);
    assert.match(page, /Edit <code>page\.vue<\/code>/);
    assert.match(layout, /<slot \/>/);
    assert.deepEqual(tsconfig.include, ["src/**/*.ts", "src/**/*.vue", "farm.config.ts"]);
    await assert.rejects(readFile(path.join(generatedDir, "src/app/page.tsx"), "utf8"));
    await assert.rejects(readFile(path.join(generatedDir, "src/app/layout.tsx"), "utf8"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("generates a Svelte starter with typed server interaction", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "create-farm-app-svelte-"));

  try {
    execFileSync(
      process.execPath,
      [
        path.join(packageDir, "bin/create-farm-app.js"),
        "svelte-app",
        "--template",
        "basic",
        "--renderer",
        "svelte",
        "--typescript",
        "--skip-install",
      ],
      { cwd: tempDir, stdio: "pipe" },
    );

    const generatedDir = path.join(tempDir, "svelte-app");
    const packageJson = JSON.parse(await readFile(path.join(generatedDir, "package.json"), "utf8"));
    const config = await readFile(path.join(generatedDir, "farm.config.ts"), "utf8");
    const page = await readFile(path.join(generatedDir, "src/app/page.svelte"), "utf8");
    const layout = await readFile(path.join(generatedDir, "src/app/layout.svelte"), "utf8");
    const tsconfig = JSON.parse(await readFile(path.join(generatedDir, "tsconfig.json"), "utf8"));
    const rendererPackage = JSON.parse(
      await readFile(path.join(packageDir, "..", "farm-svelte", "package.json"), "utf8"),
    );

    assert.equal(packageJson.dependencies["@farm.js/svelte"], rendererPackage.version);
    assert.equal(packageJson.dependencies.svelte, "5.56.8");
    assert.equal(packageJson.dependencies.react, undefined);
    assert.equal(packageJson.dependencies["react-dom"], undefined);
    assert.equal(packageJson.scripts["type-check"], "svelte-check --tsconfig ./tsconfig.json");
    assert.match(config, /renderer: svelte\(\)/);
    assert.match(config, /from "@farm\.js\/svelte"/);
    assert.match(page, /export const hydrate = true/);
    assert.match(page, /api\.greeting\.post/);
    assert.match(page, /Edit <code>page\.svelte<\/code>/);
    assert.match(page, /let message = \$state/);
    assert.match(layout, /\{@render children\?\.\(\)\}/);
    assert.deepEqual(tsconfig.include, ["src/**/*.ts", "src/**/*.svelte", "farm.config.ts"]);
    await assert.rejects(readFile(path.join(generatedDir, "src/app/page.tsx"), "utf8"));
    await assert.rejects(readFile(path.join(generatedDir, "src/app/layout.tsx"), "utf8"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

const betterAuthRenderers = [
  {
    name: "preact",
    packageName: "@farm.js/preact",
    label: "Preact",
    authClient: "better-auth/client",
    page: "page.tsx",
    form: "auth-form.tsx",
    nativePattern: /from "preact\/hooks"/,
  },
  {
    name: "solid",
    packageName: "@farm.js/solid",
    label: "Solid",
    authClient: "better-auth/solid",
    page: "page.tsx",
    form: "auth-form.tsx",
    nativePattern: /createSignal/,
  },
  {
    name: "vue",
    packageName: "@farm.js/vue",
    label: "Vue",
    authClient: "better-auth/vue",
    page: "page.vue",
    form: "auth-form.vue",
    nativePattern: /computed, ref/,
  },
  {
    name: "svelte",
    packageName: "@farm.js/svelte",
    label: "Svelte",
    authClient: "better-auth/svelte",
    page: "page.svelte",
    form: "auth-form.svelte",
    nativePattern: /\$state\(false\)/,
  },
];

test("generates renderer-native Better Auth starters", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "create-farm-app-native-auth-"));
  const templatePackage = JSON.parse(
    await readFile(path.join(packageDir, "templates/better-auth/package.json"), "utf8"),
  );

  try {
    for (const renderer of betterAuthRenderers) {
      const projectName = `${renderer.name}-auth-app`;
      execFileSync(
        process.execPath,
        [
          path.join(packageDir, "bin/create-farm-app.js"),
          projectName,
          "--template",
          "better-auth",
          "--renderer",
          renderer.name,
          "--typescript",
          "--skip-install",
        ],
        { cwd: tempDir, stdio: "pipe" },
      );

      const generatedDir = path.join(tempDir, projectName);
      const packageJson = JSON.parse(
        await readFile(path.join(generatedDir, "package.json"), "utf8"),
      );
      const config = await readFile(path.join(generatedDir, "farm.config.ts"), "utf8");
      const home = await readFile(path.join(generatedDir, "src/app", renderer.page), "utf8");
      const form = await readFile(path.join(generatedDir, "src/components", renderer.form), "utf8");
      const authClient = await readFile(path.join(generatedDir, "src/lib/auth-client.ts"), "utf8");

      assert.equal(typeof packageJson.dependencies[renderer.packageName], "string");
      assert.equal(
        packageJson.dependencies["@farm.js/better-auth"],
        templatePackage.dependencies["@farm.js/better-auth"],
      );
      assert.equal(packageJson.dependencies["better-auth"], "1.6.25");
      assert.equal(packageJson.dependencies.react, undefined);
      assert.equal(packageJson.dependencies["react-dom"], undefined);
      assert.equal(packageJson.devDependencies["@types/react"], undefined);
      assert.equal(packageJson.devDependencies["@types/react-dom"], undefined);
      assert.match(config, new RegExp(`renderer: ${renderer.name}\\(\\)`));
      assert.match(config, /auth: betterAuth\(\{ instance: auth \}\)/);
      assert.match(home, new RegExp(`FARMJS / ${renderer.label} \\+ Better Auth`));
      assert.match(home, /Get started/);
      assert.match(form, renderer.nativePattern);
      assert.doesNotMatch(form, /from "react/);
      assert.match(authClient, new RegExp(`from "${renderer.authClient.replace("/", "\\/")}"`));
      await readFile(path.join(generatedDir, "src/app/dashboard/middleware.ts"), "utf8");

      if (renderer.name === "vue" || renderer.name === "svelte") {
        await assert.rejects(readFile(path.join(generatedDir, "src/app/page.tsx"), "utf8"));
        await assert.rejects(
          readFile(path.join(generatedDir, "src/components/auth-form.tsx"), "utf8"),
        );
      }
    }
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
      assert.match(generatedResourceLinks, /href="https:\/\/farm\.js\.dev"/);
      assert.doesNotMatch(generatedResourceLinks, /https:\/\/farmjs\.dev/);
      assert.doesNotMatch(generatedResourceLinks, /Docs ↗|GitHub ↗/);

      const generatedSiteHeader = await readFile(
        path.join(generatedDir, "src/components/site-header.tsx"),
        "utf8",
      );
      assert.match(generatedSiteHeader, /href="https:\/\/farm\.js\.dev"/);
      assert.doesNotMatch(generatedSiteHeader, /https:\/\/farmjs\.dev/);

      const generatedStyles = await readFile(
        path.join(generatedDir, "src/app/globals.css"),
        "utf8",
      );
      assert.match(generatedStyles, /@fontsource-variable\/geist\/wght\.css/);
      assert.match(generatedStyles, /@fontsource-variable\/geist-mono\/wght\.css/);
      assert.match(generatedStyles, /background: rgb\(255 255 255 \/ 0\.025\)/);
      assert.match(generatedStyles, /\.hero-section \{[^}]*min-height: 100vh/s);
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
      const generatedConfig = await readFile(path.join(generatedDir, "farm.config.ts"), "utf8");
      assert.match(generatedConfig, /theme:\s*\{\s*default: "dark"/s);
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

const integrationTemplates = [
  {
    name: "ai",
    label: "AI",
    route: "ai",
    packageName: "@farm.js/ai",
    env: ["AI_GATEWAY_API_KEY"],
  },
  {
    name: "auth0",
    label: "Auth0",
    route: "auth0",
    packageName: "@farm.js/auth0",
    env: ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"],
  },
  {
    name: "authjs",
    label: "Auth.js",
    route: "authjs",
    packageName: "@farm.js/authjs",
    env: ["AUTH_SECRET", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"],
  },
  {
    name: "autumn",
    label: "Autumn",
    route: "autumn",
    packageName: "@farm.js/autumn",
    env: ["AUTUMN_SECRET_KEY", "AUTUMN_WEBHOOK_SECRET", "APP_BASE_URL"],
  },
  {
    name: "clerk",
    label: "Clerk",
    route: "clerk",
    packageName: "@farm.js/clerk",
    env: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"],
  },
  {
    name: "jobs-inngest",
    label: "Inngest",
    route: "jobs-inngest",
    packageName: "@farm.js/jobs",
    env: ["INNGEST_APP_ID", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"],
  },
  {
    name: "jobs-trigger",
    label: "Trigger.dev",
    route: "jobs-trigger",
    packageName: "@farm.js/jobs",
    env: ["TRIGGER_PROJECT_REF", "TRIGGER_SECRET_KEY", "TRIGGER_WEBHOOK_SECRET"],
  },
  {
    name: "polar",
    label: "Polar",
    route: "polar",
    packageName: "@farm.js/polar",
    env: ["POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "APP_BASE_URL"],
  },
  {
    name: "resend",
    label: "Resend",
    route: "resend",
    packageName: "@farm.js/email",
    env: ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET"],
  },
  {
    name: "stripe",
    label: "Stripe",
    route: "stripe",
    packageName: "@farm.js/stripe",
    env: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  },
  {
    name: "supabase",
    label: "Supabase",
    route: "supabase",
    packageName: "@farm.js/supabase",
    env: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "APP_BASE_URL"],
  },
  {
    name: "unkey",
    label: "Unkey",
    route: "unkey",
    packageName: "@farm.js/unkey",
    env: ["UNKEY_ROOT_KEY", "UNKEY_API_ID", "UNKEY_BASE_URL"],
  },
  {
    name: "workos",
    label: "WorkOS",
    route: "workos",
    packageName: "@farm.js/workos",
    env: ["WORKOS_CLIENT_ID", "WORKOS_API_KEY", "WORKOS_COOKIE_PASSWORD"],
  },
];

test("generates every official integration starter", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "create-farm-app-integrations-"));

  try {
    for (const template of integrationTemplates) {
      const projectName = `${template.name}-app`;
      const output = execFileSync(
        process.execPath,
        [
          path.join(packageDir, "bin/create-farm-app.js"),
          projectName,
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
      const generatedDir = path.join(tempDir, projectName);
      const packageJson = JSON.parse(
        await readFile(path.join(generatedDir, "package.json"), "utf8"),
      );
      const homePage = await readFile(path.join(generatedDir, "src/app/page.tsx"), "utf8");
      const styles = await readFile(path.join(generatedDir, "src/app/globals.css"), "utf8");
      const environment = await readFile(path.join(generatedDir, ".env.example"), "utf8");
      const readme = await readFile(path.join(generatedDir, "README.md"), "utf8");

      assert.equal(packageJson.name, projectName);
      assert.equal(packageJson.packageManager, "pnpm@11.18.0");
      assert.equal(
        packageJson.dependencies[template.packageName],
        packageJson.dependencies["@farm.js/core"],
      );
      assert.equal(packageJson.dependencies["@farm.js/integrations"], undefined);
      assert.equal(packageJson.dependencies["class-variance-authority"], "^0.7.1");
      assert.match(homePage, new RegExp(`FARMJS / ${escapeRegExp(template.label)} starter`));
      assert.match(homePage, new RegExp(`href: "/integrations/${template.route}"`));
      assert.match(homePage, new RegExp(`Start at <code>/integrations/${template.route}</code>`));
      assert.match(homePage, /label: "Get started"/);
      assert.match(homePage, /cp \.env\.example \.env\.local/);
      assert.match(styles, /\[data-theme="dark"\] \{/);
      assert.doesNotMatch(styles, /^\.dark \{/m);
      assert.match(readme, new RegExp(`^# FARMJS ${escapeRegExp(template.label)} Starter`, "m"));
      assert.match(readme, /https:\/\/farm\.js\.dev\/docs\/integrations/);
      await readFile(
        path.join(generatedDir, "src/app/integrations", template.route, "page.tsx"),
        "utf8",
      );

      for (const key of template.env) {
        assert.match(environment, new RegExp(`^${key}=`, "m"));
      }

      if (template.name === "ai") {
        await readFile(path.join(generatedDir, "src/app/api/chat/route.ts"), "utf8");
      } else {
        assert.match(
          await readFile(path.join(generatedDir, "farm.config.ts"), "utf8"),
          /integrations: appIntegrations/,
        );
        await readFile(path.join(generatedDir, "src/lib/integrations.ts"), "utf8");
      }

      if (template.name === "authjs") {
        assert.equal(packageJson.dependencies["@auth/core"], "0.34.3");
        assert.match(
          await readFile(path.join(generatedDir, "src/lib/auth.ts"), "utf8"),
          /GitHub\(\{/,
        );
      }
      if (template.name === "clerk") {
        assert.equal(packageJson.dependencies["@clerk/react"], "^6.1.0");
      }

      assert.match(output, new RegExp(`Open /integrations/${template.route}`));
      assert.match(output, /Copy \.env\.example to \.env\.local/);
    }
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

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
