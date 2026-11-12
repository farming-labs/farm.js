// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ConfigEnv, UserConfig, ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../server/create-server";
import { farmServerOnlyEntriesPlugin } from "../vite";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
}

const ICON_COUNT = 40;

/**
 * An app with three packages:
 * - icon-kit, shaped like lucide-react: CommonJS `main`, ES modules only through `module`, and a
 *   barrel over one module per icon. Each icon calls a React hook, and the barrel imports CSS.
 * - tweet-kit, bundled for the CSS module its files import.
 * - docs-kit, a docs runtime like @farming-labs/farmjs: the app imports its theme, which imports
 *   CSS, so the server graph bundles it, and Farm imports its adapter natively by package name.
 * - net-kit, shaped like @react-native-community/netinfo: a module-entry package whose peer,
 *   native-core, has Flow source, as react-native's does. Only client code uses it.
 * - chart-kit, shaped like recharts: a module-entry package with a dependency that, as under pnpm,
 *   resolves only from chart-kit's own directory.
 */
async function createProject(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "farm-ssr-prebundle-")));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  const icons: Record<string, string> = {};
  for (let index = 0; index < ICON_COUNT; index++) {
    icons[`node_modules/icon-kit/dist/esm/icons/icon-${index}.mjs`] =
      `import { createElement, useId } from "react";
export default function Icon${index}() {
  return createElement("svg", { "data-icon": ${index}, "data-id": useId() });
}
`;
  }
  await writeFiles(root, {
    "package.json": '{"private":true,"type":"module"}',
    "node_modules/icon-kit/package.json": JSON.stringify({
      name: "icon-kit",
      main: "dist/cjs/index.js",
      module: "dist/esm/index.mjs",
      sideEffects: false,
    }),
    // Node would load this build: a default import of it is the whole exports object.
    "node_modules/icon-kit/dist/cjs/index.js": "module.exports = { cjs: true };\n",
    "node_modules/icon-kit/dist/esm/index.mjs": `import "./icon-kit.css";
${Object.keys(icons)
  .map((_, index) => `export { default as Icon${index} } from "./icons/icon-${index}.mjs";`)
  .join("\n")}
`,
    "node_modules/icon-kit/dist/esm/icon-kit.css": "svg { display: inline-block; }\n",
    ...icons,
    "node_modules/tweet-kit/package.json": '{"name":"tweet-kit","main":"dist/index.js"}',
    "node_modules/tweet-kit/dist/index.js":
      'import styles from "./tweet.module.css";\nexport const tweetClass = styles.tweet;\n',
    "node_modules/tweet-kit/dist/tweet.module.css": ".tweet { color: rebeccapurple; }\n",
    "node_modules/docs-kit/package.json": JSON.stringify({
      name: "docs-kit",
      type: "module",
      exports: { ".": "./index.mjs", "./server": "./server.mjs" },
    }),
    "node_modules/docs-kit/index.mjs": 'import "./theme.css";\nexport const docsTheme = "kit";\n',
    "node_modules/docs-kit/theme.css": ":root { --docs-kit: 1; }\n",
    "node_modules/docs-kit/server.mjs": `export function createFarmDocsRuntimeHandler() {
  return async (request) =>
    new URL(request.url).pathname === "/docs-kit-probe" ? new Response("docs-kit ok") : null;
}
`,
    "node_modules/net-kit/package.json": JSON.stringify({
      name: "net-kit",
      main: "lib/index.js",
      module: "lib/index.mjs",
      peerDependencies: { "native-core": "*" },
    }),
    "node_modules/net-kit/lib/index.js": "module.exports = { cjs: true };\n",
    "node_modules/net-kit/lib/index.mjs":
      'import { NativeModules } from "native-core";\nexport const netInfo = () => NativeModules.Net;\n',
    "node_modules/native-core/package.json": '{"name":"native-core","main":"index.js"}',
    // No bundler parses this: Flow type annotations, as in react-native's own index.js.
    "node_modules/native-core/index.js":
      "// @flow\nexport const NativeModules: {| Net: string |} = { Net: 'net' };\n",
    "node_modules/chart-kit/package.json": JSON.stringify({
      name: "chart-kit",
      main: "lib/index.js",
      module: "es6/index.js",
      dependencies: { "class-join": "^1.0.0" },
    }),
    "node_modules/chart-kit/lib/index.js": "module.exports = { cjs: true };\n",
    "node_modules/chart-kit/es6/index.js":
      'import join from "class-join";\nexport const chartClass = join("chart", "bars");\n',
    "node_modules/chart-kit/node_modules/class-join/package.json":
      '{"name":"class-join","type":"module","exports":"./index.js"}',
    "node_modules/chart-kit/node_modules/class-join/index.js":
      'export default (...names) => names.join(" ");\n',
    "src/components/network-status.tsx": `"use client";
import { netInfo } from "net-kit";
export function NetworkStatus() { return <span>{String(netInfo)}</span>; }
`,
    "docs/guide.md": "---\ntitle: Guide\n---\n# Guide\n",
    "farm.config.ts": `export default {
  docs: {
    enabled: true,
    entry: "/docs",
    contentDir: "docs",
    adapter: { id: "docs-kit", protocol: 1, server: "docs-kit/server", react: "react" },
  },
  images: { provider: "none" },
};
`,
    "src/app/layout.tsx": `import { docsTheme } from "docs-kit";
export default function Layout({ children }) { return <div data-theme={docsTheme}>{children}</div>; }
`,
    "src/app/page.tsx": `import { Icon3 } from "icon-kit";
import { tweetClass } from "tweet-kit";
import { chartClass } from "chart-kit";
export default function Page() {
  return <main className={tweetClass}><Icon3 /><figure className={chartClass} /></main>;
}
`,
  });
  return root;
}

function originOf(server: ViteDevServer): string {
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

function loadedFiles(server: ViteDevServer): string[] {
  return [...server.environments.ssr.moduleGraph.idToModuleMap.values()].flatMap((module) =>
    module.file ? [module.file.split(path.sep).join("/")] : [],
  );
}

describe("development SSR pre-bundling", () => {
  it("loads a module-entry package as one pre-bundled module and renders it as before", async () => {
    const root = await createProject();
    const server = await createServer({ root });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const origin = originOf(server);

    const page = await fetch(`${origin}/`, { headers: { accept: "text/html" } });
    expect(page.status).toBe(200);
    const html = await page.text();
    // The ES module build rendered, through the app's React: the icon's hook ran.
    expect(html).toMatch(/<svg data-icon="3" data-id="[^"]+"/);
    expect(html).toMatch(/<main class="[^"]*tweet[^"]*">/);

    const files = loadedFiles(server);
    // Served unbundled, the barrel would load every icon module on this first page.
    expect(files.filter((file) => file.includes("/icon-kit/dist/esm/icons/"))).toEqual([]);
    const prebundled = path.join(root, "node_modules", ".vite", "deps_ssr");
    await expect(fs.access(path.join(prebundled, "icon-kit.js"))).resolves.toBeUndefined();
    // A bundle holds only its package's modules: net-kit's Flow peer stays an import, so
    // pre-bundling it neither parses nor fails on that peer.
    const netKit = await fs.readFile(path.join(prebundled, "net-kit.js"), "utf8");
    expect(netKit).toMatch(/from\s*["']native-core["']/);
    // Packages bundled for their stylesheet imports are still served unbundled.
    const posixRoot = root.split(path.sep).join("/");
    expect(files).toContain(`${posixRoot}/node_modules/tweet-kit/dist/index.js`);
    expect(files).toContain(`${posixRoot}/node_modules/docs-kit/index.mjs`);
    expect(html).toContain('data-theme="kit"');
    // So is one with its own dependencies, which a bundle could not resolve under pnpm.
    expect(files).toContain(`${posixRoot}/node_modules/chart-kit/es6/index.js`);
    expect(html).toContain('<figure class="chart bars">');

    expect(await (await fetch(`${origin}/docs-kit-probe`)).text()).toBe("docs-kit ok");

    // A restart sets Farm up again with the SSR optimizer already running: the docs adapter and
    // the pre-bundled package still load.
    await server.restart();
    // The restarted server listens on its configured port, not the one passed to listen().
    const restartedOrigin = originOf(server);
    expect(await (await fetch(`${restartedOrigin}/docs-kit-probe`)).text()).toBe("docs-kit ok");
    const restarted = await fetch(`${restartedOrigin}/`, { headers: { accept: "text/html" } });
    expect(await restarted.text()).toMatch(/<svg data-icon="3"/);
  }, 120_000);
});

describe("development SSR pre-bundling in Node", () => {
  // Under Vitest, a dynamic import goes through Vitest's own loader, which accepts a `?v=` query
  // on a file path. The dev server's native imports only show what Node does from core's build.
  it("loads the docs adapter natively while the SSR optimizer versions dependency ids", async () => {
    const root = await createProject();
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
    await writeFiles(root, {
      "start-dev.mjs": `import { createServer } from "@farm.js/core/server";
const server = await createServer({ root: process.cwd() });
await server.listen(Number(process.env.FARM_TEST_PORT));
console.log("FARM_TEST_READY");
`,
    });
    const port = await getAvailablePort();
    const child = spawn(process.execPath, ["start-dev.mjs"], {
      cwd: root,
      env: { ...process.env, FARM_TEST_PORT: String(port), NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: string[] = [];
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (chunk) => {
          output.push(String(chunk));
          if (output.join("").includes("FARM_TEST_READY")) resolve();
        });
        child.stderr.on("data", (chunk) => output.push(String(chunk)));
        child.once("exit", () => reject(new Error(`dev server exited:\n${output.join("")}`)));
      });
      const probe = await fetch(`http://localhost:${port}/docs-kit-probe`);
      expect(await probe.text()).toBe("docs-kit ok");
      const page = await fetch(`http://localhost:${port}/`, { headers: { accept: "text/html" } });
      expect(await page.text()).toMatch(/<svg data-icon="3"/);
    } finally {
      if (child.exitCode === null) child.kill();
      await exited;
    }
  }, 120_000);
});

describe("SSR pre-bundling config", () => {
  async function ssrConfig(prebundleServerPackages?: boolean) {
    const root = await createProject();
    const plugin = farmServerOnlyEntriesPlugin({ prebundleServerPackages });
    const config = (plugin.config as (config: UserConfig, env: ConfigEnv) => UserConfig)(
      { root },
      { command: "serve", mode: "development" },
    );
    return config.ssr!;
  }

  it("pre-bundles only module-entry packages, each without its dependencies", async () => {
    const ssr = await ssrConfig(true);
    expect(ssr.noExternal).toEqual(
      expect.arrayContaining(["chart-kit", "docs-kit", "icon-kit", "net-kit", "tweet-kit"]),
    );
    expect(ssr.optimizeDeps?.include).toEqual(["icon-kit", "net-kit"]);
    const external = ssr.optimizeDeps?.rolldownOptions?.external as (id: string) => boolean;
    for (const id of [
      "react",
      "react/jsx-runtime",
      "react-dom/server",
      "native-core",
      "icon-kits",
    ]) {
      expect(external(id), id).toBe(true);
    }
    for (const id of ["icon-kit", "icon-kit/dist/esm/icons/icon-1.mjs", "net-kit", "./icon.mjs"]) {
      expect(external(id), id).toBe(false);
    }
    expect(external("/abs/node_modules/icon-kit/dist/esm/index.mjs")).toBe(false);
    expect(external("C:/abs/node_modules/icon-kit/dist/esm/index.mjs")).toBe(false);
  });

  it("leaves other Vite servers unchanged, such as the one a build loads modules with", async () => {
    const ssr = await ssrConfig();
    expect(ssr.noExternal).toEqual(expect.arrayContaining(["icon-kit", "tweet-kit"]));
    expect(ssr.optimizeDeps).toBeUndefined();
  });
});
