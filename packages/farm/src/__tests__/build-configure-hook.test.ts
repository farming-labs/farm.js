// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_PREFIX = ".tmp-configure-hook-";
const created: string[] = [];

/** Writes a minimal app whose farm.config.ts is `configSource`. */
async function createFixture(configSource: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, FIXTURE_PREFIX));
  created.push(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "body{margin:0}");
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `export default function Page() { return <div>hi</div>; }`,
  );
  await fs.writeFile(path.join(root, "farm.config.ts"), configSource);
  return root;
}

async function buildFixture(root: string): Promise<void> {
  const userConfig = await loadConfig(root, undefined, "production");
  const config = await resolveConfig({ ...userConfig, root }, "production");
  await build(config, { root, preset: "vercel" });
}

async function exists(target: string): Promise<boolean> {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}

afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((root) =>
        fs
          .rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
          .catch(() => {}),
      ),
  );
});

describe("plugin configure hook during build", () => {
  it("runs the hook", async () => {
    const marker = "configure-ran.txt";
    const root = await createFixture(
      `import fs from "node:fs";
import path from "node:path";
import { definePlugin } from "@farm.js/core";

export default {
  srcDir: "src",
  plugins: [
    definePlugin({
      name: "test:ran",
      configure(config) {
        fs.writeFileSync(path.join(config.root, ${JSON.stringify(marker)}), "ran");
        return config;
      },
    }),
  ],
};
`,
    );

    await buildFixture(root);

    expect(await exists(path.join(root, marker))).toBe(true);
  }, 300000);

  it("derives build output from the config the hook returns", async () => {
    const root = await createFixture(
      `import { definePlugin } from "@farm.js/core";

export default {
  srcDir: "src",
  plugins: [
    definePlugin({
      name: "test:dist-dir",
      configure(config) {
        return { ...config, distDir: ".farm-from-plugin" };
      },
    }),
  ],
};
`,
    );

    await buildFixture(root);

    // distDir is read while the build computes its output paths. Running the
    // hook after that point would leave the build writing to the original
    // directory even though the returned config asked for another one.
    const manifest = "route-runtime-manifest.json";
    expect(await exists(path.join(root, ".farm-from-plugin", manifest))).toBe(true);
    expect(await exists(path.join(root, ".farm", manifest))).toBe(false);
  }, 300000);

  it("keeps the current config when the hook returns nothing", async () => {
    // `configure` is documented as returning a value only when the plugin needs
    // to replace one, so a void return has to leave the build on the config it
    // already had rather than on undefined.
    const root = await createFixture(
      `import { definePlugin } from "@farm.js/core";

export default {
  srcDir: "src",
  distDir: ".farm-configured",
  plugins: [
    definePlugin({
      name: "test:void-return",
      configure() {},
    }),
  ],
};
`,
    );

    await buildFixture(root);

    expect(await exists(path.join(root, ".farm-configured", "route-runtime-manifest.json"))).toBe(
      true,
    );
  }, 300000);

  it("passes the returned config to later hooks", async () => {
    const seen = "seen-dist-dir.txt";
    const root = await createFixture(
      `import fs from "node:fs";
import path from "node:path";
import { definePlugin } from "@farm.js/core";

export default {
  srcDir: "src",
  plugins: [
    definePlugin({
      name: "test:later-hooks",
      configure(config) {
        return { ...config, distDir: ".farm-from-plugin" };
      },
      build: {
        before(bundle, context) {
          fs.writeFileSync(
            path.join(context.config.root, ${JSON.stringify(seen)}),
            JSON.stringify({ bundle: bundle.distDir, context: context.config.distDir }),
          );
        },
      },
    }),
  ],
};
`,
    );

    await buildFixture(root);

    const seenValues = JSON.parse(await fs.readFile(path.join(root, seen), "utf8"));
    expect(seenValues).toEqual({
      bundle: ".farm-from-plugin",
      context: ".farm-from-plugin",
    });
  }, 300000);
});
