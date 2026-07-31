import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    assert.equal(packageJson.scripts.start, "node .output/server/index.mjs");
    assert.equal(packageJson.dependencies["@farm.js/core"], "latest");
    assert.equal(packageJson.devDependencies["@farm.js/cli"], "latest");
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
  } finally {
    await rm(root, { recursive: true, force: true });
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
