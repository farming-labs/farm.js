import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  createFrameworkMigrationPlan,
  generateFarmArtifacts,
  inspectFrameworkMigrations,
  migrateFarm,
} = require("../dist/index.js");
const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

test("runs one-shot migration commands", async () => {
  const root = await createTempProject();

  try {
    await migrateFarm({
      root,
      commands: [nodeCommand("require('node:fs').writeFileSync('migrated.txt', 'ok')")],
    });

    assert.equal(await readFile(path.join(root, "migrated.txt"), "utf8"), "ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prints migration commands without running them in dry-run mode", async () => {
  const root = await createTempProject();

  try {
    await migrateFarm({
      root,
      dryRun: true,
      commands: [nodeCommand("require('node:fs').writeFileSync('dry-run.txt', 'nope')")],
    });

    await assert.rejects(() => readFile(path.join(root, "dry-run.txt"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loads migration commands from farm.config", async () => {
  const root = await createTempProject();
  const command = nodeCommand(
    "require('node:fs').writeFileSync('configured.txt', process.env.FARM_MIGRATION_VALUE)",
  );

  try {
    await writeFile(
      path.join(root, "farm.config.mjs"),
      `export default {
  migrations: {
    commands: [
      {
        name: "configured migration",
        command: ${JSON.stringify(command)},
        env: {
          FARM_MIGRATION_VALUE: "configured",
        },
      },
    ],
  },
};
`,
      "utf8",
    );

    await migrateFarm({ root });

    assert.equal(await readFile(path.join(root, "configured.txt"), "utf8"), "configured");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generates route and API types", async () => {
  const root = await createTempProject();

  try {
    await mkdir(path.join(root, "src", "app", "about"), { recursive: true });
    await mkdir(path.join(root, "src", "app", "api", "hello"), { recursive: true });
    await writeFile(
      path.join(root, "src", "app", "page.tsx"),
      "export default function Home() { return null; }\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "app", "about", "page.tsx"),
      "export default function About() { return null; }\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "app", "api", "hello", "route.ts"),
      "export const POST = async () => Response.json({ ok: true });\n",
      "utf8",
    );

    await generateFarmArtifacts({ root });

    const routeTypes = await readFile(path.join(root, "src", "farm.d.ts"), "utf8");
    const apiTypes = await readFile(path.join(root, "src", "lib", "api.generated.ts"), "utf8");

    assert.ok(routeTypes.includes('"/about"'));
    assert.ok(apiTypes.includes("hello: {"));
    assert.ok(apiTypes.includes("post: typeof POST_hello;"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generates typed i18n declarations", async () => {
  const root = await createTempProject();

  try {
    await mkdir(path.join(root, "src", "app"), { recursive: true });
    await mkdir(path.join(root, "src", "messages"), { recursive: true });
    await writeFile(
      path.join(root, "farm.config.mjs"),
      `export default {
  i18n: {
    locales: ["en", "fr"],
    defaultLocale: "en",
    strict: true,
  },
};
`,
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "app", "page.tsx"),
      "export default function Home() { return null; }\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "messages", "en.json"),
      JSON.stringify({
        home: {
          welcome: "Welcome, {name}!",
          items: "{count, plural, one {# item} other {# items}}",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "messages", "fr.json"),
      JSON.stringify({
        home: {
          welcome: "Bienvenue, {name} !",
          items: "{count, plural, one {# article} other {# articles}}",
        },
      }),
      "utf8",
    );

    await generateFarmArtifacts({ root });

    const i18nTypes = await readFile(path.join(root, "src", "farm.d.ts"), "utf8");
    assert.ok(i18nTypes.includes('"fr": true'));
    assert.ok(i18nTypes.includes('"home.welcome": { "name": string }'));
    assert.ok(i18nTypes.includes('"home.items": { "count": number }'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs farm migrate through the CLI", async () => {
  const root = await createTempProject();

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cliBin,
      "migrate",
      "--root",
      root,
      "--command",
      nodeCommand("require('node:fs').writeFileSync('cli.txt', 'cli-ok')"),
    ]);

    assert.match(stdout, /Ran 1 migration command successfully/);
    assert.equal(await readFile(path.join(root, "cli.txt"), "utf8"), "cli-ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inspects framework migration sources", async () => {
  const root = await createTempProject({
    dependencies: {
      next: "latest",
      "@tanstack/react-router": "latest",
    },
  });

  try {
    await mkdir(path.join(root, "app"), { recursive: true });
    await mkdir(path.join(root, "src", "routes"), { recursive: true });

    const detections = await inspectFrameworkMigrations(root);

    assert.ok(detections.some((entry) => entry.source === "next"));
    assert.ok(detections.some((entry) => entry.source === "tanstack"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs framework migration inspection through the CLI", async () => {
  const root = await createTempProject({
    dependencies: {
      next: "latest",
    },
  });

  try {
    await mkdir(path.join(root, "app"), { recursive: true });

    const { stdout } = await execFileAsync(process.execPath, [
      cliBin,
      "migrate",
      "inspect",
      "--root",
      root,
    ]);

    assert.match(stdout, /next: \d+% confidence/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepares and applies a code-first Next app migration", async () => {
  const root = await createTempProject({
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start",
    },
    dependencies: {
      next: "latest",
      react: "latest",
      "react-dom": "latest",
    },
  });

  try {
    await mkdir(path.join(root, "app", "about"), { recursive: true });
    await writeFile(
      path.join(root, "app", "about", "page.tsx"),
      `import FarmLink from "next/link";
import { redirect, usePathname } from "next/navigation";
import { cookies, headers } from "next/headers";

export default function AboutPage() {
  if (cookies().has("session")) redirect("/dashboard");
  const pathname = usePathname();
  headers().get("x-demo");
  return <FarmLink href="/">Home</FarmLink>;
}
`,
      "utf8",
    );

    const dryRunPlan = await createFrameworkMigrationPlan(root, "next");
    assert.ok(
      dryRunPlan.operations.some((operation) => operation.description.includes("Copy Next")),
    );
    await assert.rejects(() =>
      readFile(path.join(root, "src", "app", "about", "page.tsx"), "utf8"),
    );

    await migrateFarm({ root, source: "next", write: true });

    const page = await readFile(path.join(root, "src", "app", "about", "page.tsx"), "utf8");
    assert.match(page, /import \{ Link as FarmLink \} from "@farm.js\/core\/client";/);
    assert.match(page, /from "@farm.js\/core\/navigation";/);
    assert.match(page, /from "@farm.js\/core\/headers";/);
    assert.doesNotMatch(page, /from "next\//);
    const farmConfig = await readFile(path.join(root, "farm.config.ts"), "utf8");
    assert.match(farmConfig, /defineConfig/);
    assert.doesNotMatch(farmConfig, /defineFarmConfig/);
    assert.doesNotMatch(farmConfig, /srcDir/);

    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    assert.equal(packageJson.scripts.dev, "farm dev");
    assert.equal(packageJson.scripts.build, "farm build");
    assert.equal(packageJson.scripts.start, "node .farm/.output/server/index.mjs");
    assert.equal(packageJson.dependencies["@farm.js/core"], "latest");
    assert.equal(packageJson.devDependencies["@farm.js/cli"], "latest");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rewrites Next imports in shared code outside the App Router", async () => {
  const root = await createTempProject({
    scripts: { dev: "next dev", build: "next build" },
    dependencies: { next: "latest", react: "latest", "react-dom": "latest" },
  });

  try {
    await mkdir(path.join(root, "app"), { recursive: true });
    await mkdir(path.join(root, "components"), { recursive: true });
    await mkdir(path.join(root, "content"), { recursive: true });
    await writeFile(
      path.join(root, "app", "page.tsx"),
      `import { Nav } from "@/components/nav";\nexport default function Home() {\n  return <Nav />;\n}\n`,
      "utf8",
    );
    await writeFile(
      path.join(root, "components", "nav.tsx"),
      `import Link from "next/link";\nimport Image from "next/image";\nimport { usePathname } from "next/navigation";\n\nexport function Nav() {\n  usePathname();\n  return <Link href="/"><Image alt="" src="/a.png" width={1} height={1} /></Link>;\n}\n`,
      "utf8",
    );
    // A docs page that shows Next.js code stays as written.
    const guide = '```tsx\nimport Link from "next/link";\n```\n';
    await writeFile(path.join(root, "content", "guide.mdx"), guide, "utf8");
    await writeFile(
      path.join(root, "tsconfig.json"),
      // Next's generated tsconfig: the "include" globs follow the "@/*" alias.
      `{\n  // Next's default alias\n  "compilerOptions": { "paths": { "@/*": ["./*"] } },\n  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],\n}\n`,
      "utf8",
    );
    await writeFile(path.join(root, "next.config.ts"), "export default {};\n", "utf8");

    const plan = await createFrameworkMigrationPlan(root, "next");
    assert.ok(
      plan.manual.some((note) => note.includes("components/nav.tsx; it still imports next/image")),
    );
    assert.ok(plan.manual.some((note) => note.includes("maps @/* to ./*")));
    assert.ok(plan.manual.some((note) => note.includes("next.config.*")));

    await migrateFarm({ root, source: "next", write: true });

    const nav = await readFile(path.join(root, "components", "nav.tsx"), "utf8");
    assert.match(nav, /import \{ Link \} from "@farm.js\/core\/client";/);
    assert.match(nav, /from "@farm.js\/core\/navigation";/);
    assert.match(nav, /from "next\/image";/);
    assert.equal(await readFile(path.join(root, "content", "guide.mdx"), "utf8"), guide);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("leaves Next imports Farm does not export in place and names them", async () => {
  const root = await createTempProject({
    dependencies: { next: "latest", react: "latest", "react-dom": "latest" },
  });

  try {
    await mkdir(path.join(root, "app"), { recursive: true });
    const page = `import { useParams, usePathname } from "next/navigation";
import { redirect, RedirectType } from "next/navigation";
import {
  notFound,
  useRouter as useAppRouter,
  type FarmRedirectStatus,
} from "next/navigation";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { useSelectedLayoutSegment as useSegment } from "next/navigation";
import * as navigation from "next/navigation";
import { cookies, draftMode } from "next/headers";
import { headers } from "next/headers";
export { useSearchParams } from "next/navigation";
export * from "next/headers";
const loadImage = () => import("next/image");
const router = require("next/router");

export default function Page() {
  return null;
}
`;
    await writeFile(path.join(root, "app", "page.tsx"), page, "utf8");

    const plan = await createFrameworkMigrationPlan(root, "next");
    const notes = plan.manual.filter((note) => note.startsWith("Review page.tsx;"));
    for (const expected of [
      "it still imports next/navigation because @farm.js/core/navigation does not export useParams.",
      "it still imports next/navigation because @farm.js/core/navigation does not export RedirectType.",
      "it still imports next/navigation because @farm.js/core/navigation does not export ReadonlyURLSearchParams.",
      "it still imports next/navigation because @farm.js/core/navigation does not export useSelectedLayoutSegment.",
      "it still imports next/navigation because @farm.js/core/navigation does not export every name (*).",
      "it still imports next/headers because @farm.js/core/headers does not export draftMode.",
      "it still imports next/headers because @farm.js/core/headers does not export every name (*).",
      "it loads next/image with import(), which the migration does not rewrite.",
      "it loads next/router with require(), which the migration does not rewrite.",
    ]) {
      assert.ok(
        notes.some((note) => note.endsWith(expected)),
        `missing note: ${expected}\n${notes.join("\n")}`,
      );
    }
    assert.equal(notes.length, 9, notes.join("\n"));

    await migrateFarm({ root, source: "next", write: true });

    const migrated = await readFile(path.join(root, "src", "app", "page.tsx"), "utf8");
    // Supported imports move to Farm; the rest stay as written instead of breaking the build.
    for (const statement of [
      `import { useParams, usePathname } from "next/navigation";`,
      `import { redirect, RedirectType } from "next/navigation";`,
      `import type { ReadonlyURLSearchParams } from "next/navigation";`,
      `import { useSelectedLayoutSegment as useSegment } from "next/navigation";`,
      `import * as navigation from "next/navigation";`,
      `import { cookies, draftMode } from "next/headers";`,
      `export * from "next/headers";`,
      `const loadImage = () => import("next/image");`,
      `const router = require("next/router");`,
      `import {\n  notFound,\n  useRouter as useAppRouter,\n  type FarmRedirectStatus,\n} from "@farm.js/core/navigation";`,
      `import { headers } from "@farm.js/core/headers";`,
      `export { useSearchParams } from "@farm.js/core/navigation";`,
    ]) {
      assert.ok(migrated.includes(statement), `missing: ${statement}\n${migrated}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rewrites next/navigation and next/headers names exactly as core exports them", async () => {
  const ts = require("typescript");
  const migrateSource = await readFile(path.resolve(testDir, "../src/migrate.ts"), "utf8");
  for (const [moduleId, entry] of [
    ["next/navigation", "navigation.ts"],
    ["next/headers", "headers.ts"],
  ]) {
    const sourcePath = path.resolve(testDir, "../../farm/src", entry);
    const file = ts.createSourceFile(
      sourcePath,
      await readFile(sourcePath, "utf8"),
      ts.ScriptTarget.Latest,
    );
    const exported = new Set();
    for (const statement of file.statements) {
      if (ts.isExportDeclaration(statement)) {
        assert.ok(statement.exportClause, `${entry} uses export *; list its names in migrate.ts`);
        for (const element of statement.exportClause.elements) exported.add(element.name.text);
      } else if (
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            exported.add(declaration.name.text);
          }
        } else if (statement.name) {
          exported.add(statement.name.text);
        }
      }
    }
    const block = migrateSource.match(
      new RegExp(`"${moduleId}": \\{[\\s\\S]*?names: new Set\\(\\[([\\s\\S]*?)\\]\\)`),
    );
    assert.ok(block, `no allowlist for ${moduleId}`);
    const allowed = new Set(Array.from(block[1].matchAll(/"([^"]+)"/g), (match) => match[1]));
    assert.deepEqual([...allowed].sort(), [...exported].sort(), moduleId);

    // Every name core exports is rewritten.
    const root = await createTempProject({ dependencies: { next: "latest" } });
    try {
      await mkdir(path.join(root, "app"), { recursive: true });
      await writeFile(
        path.join(root, "app", "page.tsx"),
        `import { ${[...exported].join(", ")} } from "${moduleId}";\n`,
        "utf8",
      );
      const plan = await createFrameworkMigrationPlan(root, "next");
      assert.ok(!plan.manual.some((note) => note.includes(`imports ${moduleId}`)), moduleId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("walks shared code without following symlinks or skipping nested build folders", async () => {
  const root = await createTempProject({ dependencies: { next: "latest" } });
  const outside = await mkdtemp(path.join(os.tmpdir(), "farm-cli-migrate-outside-"));
  const nextImport = `import { usePathname } from "next/navigation";\nexport const a = usePathname;\n`;

  try {
    await mkdir(path.join(root, "app"), { recursive: true });
    await writeFile(path.join(root, "app", "page.tsx"), "export default () => null;\n", "utf8");
    await mkdir(path.join(root, "lib", "build"), { recursive: true });
    await writeFile(path.join(root, "lib", "build", "link.tsx"), nextImport, "utf8");
    await mkdir(path.join(root, "build"), { recursive: true });
    await writeFile(path.join(root, "build", "output.js"), nextImport, "utf8");
    await writeFile(path.join(outside, "shared.ts"), nextImport, "utf8");
    // A link back to a parent would loop forever (ELOOP), and one leaving the project must
    // not be written through.
    await symlink(root, path.join(root, "lib", "loop"), "junction");
    await symlink(outside, path.join(root, "lib", "outside"), "junction");

    await migrateFarm({ root, source: "next", write: true });

    assert.match(
      await readFile(path.join(root, "lib", "build", "link.tsx"), "utf8"),
      /from "@farm.js\/core\/navigation"/,
    );
    assert.equal(await readFile(path.join(root, "build", "output.js"), "utf8"), nextImport);
    assert.equal(await readFile(path.join(outside, "shared.ts"), "utf8"), nextImport);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("resolves the tsconfig @/* alias against baseUrl", async () => {
  for (const [baseUrl, note] of [
    ["./src", null],
    ["src/", null],
    ["./lib", "maps @/* to ./lib/*"],
  ]) {
    const root = await createTempProject({ dependencies: { next: "latest" } });
    try {
      await mkdir(path.join(root, "app"), { recursive: true });
      await writeFile(path.join(root, "app", "page.tsx"), "export default () => null;\n", "utf8");
      await writeFile(
        path.join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { baseUrl, paths: { "@/*": ["./*"] } } }),
        "utf8",
      );
      const plan = await createFrameworkMigrationPlan(root, "next");
      const aliasNotes = plan.manual.filter((entry) => entry.includes("maps @/* to"));
      if (note)
        assert.ok(
          aliasNotes.some((entry) => entry.includes(note)),
          baseUrl,
        );
      else assert.deepEqual(aliasNotes, [], baseUrl);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("keeps a Next root layout instead of overwriting it with the stub", async () => {
  const root = await createTempProject({
    scripts: { dev: "next dev", build: "next build" },
    dependencies: { next: "latest", react: "latest", "react-dom": "latest" },
  });

  try {
    await mkdir(path.join(root, "app"), { recursive: true });
    await writeFile(
      path.join(root, "app", "layout.tsx"),
      `export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="app-shell">{children}</body>
    </html>
  );
}
`,
      "utf8",
    );

    await migrateFarm({ root, source: "next", write: true });

    const layout = await readFile(path.join(root, "src", "app", "layout.tsx"), "utf8");
    // The user's real layout must survive, not be replaced by the minimal stub.
    assert.match(layout, /app-shell/);
    assert.match(layout, /<html lang="en">/);
    assert.doesNotMatch(layout, /import type \{ LayoutProps \}/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applies a simple TanStack file-route migration", async () => {
  const root = await createTempProject({
    scripts: {
      dev: "vite",
      build: "vite build",
    },
    dependencies: {
      "@tanstack/react-router": "latest",
      react: "latest",
      "react-dom": "latest",
    },
  });

  try {
    await mkdir(path.join(root, "src", "routes"), { recursive: true });
    await writeFile(
      path.join(root, "src", "routes", "posts.$postId.tsx"),
      `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/posts/$postId")({
  component: PostPage,
});

function PostPage() {
  return <h1>Post</h1>;
}
`,
      "utf8",
    );

    await migrateFarm({ root, source: "tanstack", write: true });

    const page = await readFile(
      path.join(root, "src", "app", "posts", "[postId]", "page.tsx"),
      "utf8",
    );
    assert.match(page, /export default PostPage;/);

    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    assert.equal(packageJson.scripts.dev, "farm dev");
    assert.equal(packageJson.scripts.build, "farm build");
    // TanStack starters have no start script; add the one new Farm projects use.
    assert.equal(packageJson.scripts.start, "node .farm/.output/server/index.mjs");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("replaces a TanStack start script and keeps a custom one", async () => {
  for (const [start, expected] of [
    ["vinxi start", "node .farm/.output/server/index.mjs"],
    ["node .output/server/index.mjs", "node .farm/.output/server/index.mjs"],
    ["node server/custom.mjs", "node server/custom.mjs"],
  ]) {
    const root = await createTempProject({
      scripts: { dev: "vinxi dev", build: "vinxi build", start },
      dependencies: { "@tanstack/react-router": "latest" },
    });
    try {
      await mkdir(path.join(root, "src", "routes"), { recursive: true });
      await writeFile(
        path.join(root, "src", "routes", "index.tsx"),
        "export default function Home() { return null; }\n",
        "utf8",
      );
      await migrateFarm({ root, source: "tanstack", write: true });
      const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
      assert.equal(packageJson.scripts.start, expected, start);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

async function createTempProject(packageJson = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-migrate-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module", dependencies: {}, ...packageJson }, null, 2),
    "utf8",
  );
  return root;
}

function nodeCommand(script) {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}
