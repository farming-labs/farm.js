// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { buildFarmRsc } from "../rsc-pipeline";
import { getAvailablePort } from "./dev-server-port";

// A production build on the RSC pipeline, served by its Nitro node-server output: the server
// loads the app's `plugins` when one has server hooks, so what a plugin does when it's created,
// such as `bot()` keeping its settings for `verifyBot()`, happens there too.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exampleModules = path.resolve(packageRoot, "../../examples/server-components/node_modules");
const roots = new Set<string>();
const children = new Set<ChildProcess>();

afterEach(async () => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  await Promise.all(
    [...roots].map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 10 })),
  );
  roots.clear();
});

const FILES: Record<string, string> = {
  "package.json": '{"name":"signup","version":"1.0.0","type":"module","private":true}',
  // `definePlugin` can't run in the standalone RSC server, so only the plugin with server hooks
  // may reach it.
  "farm.config.ts": `import { definePlugin } from "@farm.js/core";
import { recorder } from "./recorder";
const browserOnly = definePlugin({ name: "browser-only", client: { setup() {} } });
export default {
  deploymentId: "fixed",
  experimental: { serverComponents: { mode: "rsc" } },
  plugins: [browserOnly, recorder("from farm.config.ts")],
};`,
  // An empty `runtime` is how a plugin asks the server to load it, as `bot()` does.
  "recorder.ts": `export function recorder(label: string) {
  (globalThis as Record<symbol, unknown>)[Symbol.for("farm-test/recorder")] = label;
  return { name: "recorder", runtime: {} };
}`,
  "src/app/layout.tsx": `export default function Layout({ children }) {
  return <html><body>{children}</body></html>;
}`,
  "src/app/page.tsx": `export default function Page() { return <main>home</main>; }`,
  "src/app/api/recorder/route.ts": `export function GET() {
  const label = (globalThis as Record<symbol, unknown>)[Symbol.for("farm-test/recorder")];
  return Response.json({ label: label ?? null });
}`,
};

async function link(root: string, name: string, target: string) {
  const destination = path.join(root, "node_modules", ...name.split("/"));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.symlink(await fs.realpath(target), destination, "junction");
}

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-rsc-plugins-"));
  roots.add(root);
  await link(root, "@farm.js/core", packageRoot);
  for (const name of [
    "@farm.js/plugin",
    "@vitejs/plugin-rsc",
    "react-server-dom-webpack",
    "react",
    "react-dom",
    "vite",
  ]) {
    await link(root, name, path.join(exampleModules, ...name.split("/")));
  }
  for (const [file, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return root;
}

const OUTPUT = path.join(".farm", ".output");

async function buildApp(root: string) {
  // As `farm build` runs it: vitest sets NODE_ENV to "test", which builds React's development JSX.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const userConfig = await loadConfig(root, undefined, "production");
    await buildFarmRsc(userConfig as Record<string, unknown>, {
      root,
      preset: "node-server",
      outputDir: OUTPUT,
    });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
}

/** Starts the built server and fetches `pathname` once it answers. */
async function fetchFromServer(root: string, pathname: string): Promise<Response> {
  const port = await getAvailablePort();
  const child = spawn(process.execPath, [path.join(root, OUTPUT, "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let output = "";
  child.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const deadline = Date.now() + 30_000;
  while (child.exitCode === null && Date.now() < deadline) {
    try {
      return await fetch(`http://127.0.0.1:${port}${pathname}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`server did not answer (exit ${child.exitCode}): ${output}`);
}

describe("a production server on the RSC pipeline", () => {
  it("runs the app's plugins when one has server hooks", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    const root = await createApp();
    await buildApp(root);

    const response = await fetchFromServer(root, "/api/recorder");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ label: "from farm.config.ts" });
  }, 300_000);
});
