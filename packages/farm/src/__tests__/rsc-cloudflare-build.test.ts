// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { buildFarmRsc } from "../rsc-pipeline";

// A production build on the RSC pipeline for Cloudflare Pages, run in workerd (Miniflare) with the
// compatibility date and flags the build wrote, as `wrangler pages deploy` runs it.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exampleModules = path.resolve(packageRoot, "../../examples/server-components/node_modules");
const roots = new Set<string>();
const disposers = new Set<() => Promise<void>>();

afterEach(async () => {
  for (const dispose of disposers) await dispose();
  disposers.clear();
  await Promise.all(
    [...roots].map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 10 })),
  );
  roots.clear();
});

const FILES: Record<string, string> = {
  "package.json": '{"name":"worker-app","version":"1.0.0","type":"module","private":true}',
  "farm.config.ts": `export default {
  deploymentId: "fixed",
  experimental: { serverComponents: { mode: "rsc" } },
};`,
  "src/app/layout.tsx": `export default function Layout({ children }) {
  return <html><body>{children}</body></html>;
}`,
  "src/app/page.tsx": `import { Counter } from "./counter";
import { ReactBuild } from "./react-build";
export const dynamic = "force-dynamic";
export default function Page() {
  return <main>home <Counter /><ReactBuild /></main>;
}`,
  // React's development build exports captureOwnerStack; its production build for SSR doesn't.
  "src/app/react-build.tsx": `"use client";
import * as React from "react";
export function ReactBuild() {
  const build = typeof React.captureOwnerStack === "function" ? "development" : "production";
  return <p>{"react " + build}</p>;
}`,
  "src/app/counter.tsx": `"use client";
import { useState } from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>count {count}</button>;
}`,
  "src/app/api/secret/route.ts": `export function GET() {
  return Response.json({ secret: process.env.FARM_TEST_SECRET ?? null });
}`,
};

async function link(root: string, name: string, target: string) {
  const destination = path.join(root, "node_modules", ...name.split("/"));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.symlink(await fs.realpath(target), destination, "junction");
}

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-rsc-cloudflare-"));
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
      preset: "cloudflare-pages",
      outputDir: OUTPUT,
    });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
}

/** Runs the Pages output's worker in workerd, configured from the Wrangler config the build wrote. */
async function startWorker(root: string) {
  const { Miniflare } = await import("miniflare");
  const output = path.join(root, OUTPUT);
  const workerDirectory = path.join(output, "_worker.js");
  const wrangler = JSON.parse(
    await fs.readFile(path.join(workerDirectory, "wrangler.json"), "utf8"),
  );
  const worker = new Miniflare({
    compatibilityDate: wrangler.compatibility_date,
    compatibilityFlags: wrangler.compatibility_flags,
    modules: true,
    modulesRoot: workerDirectory,
    scriptPath: path.join(workerDirectory, "index.js"),
    // Pages loads every .js and .mjs file in `_worker.js/` as an ES module.
    modulesRules: [{ type: "ESModule", include: ["**/*.js", "**/*.mjs"] }],
    // Stands in for wrangler's NODE_ENV, which picks React's build when it is left to the runtime:
    // `wrangler pages dev` sets "development", and so does a deploy from a shell that sets it.
    bindings: { FARM_TEST_SECRET: "from the worker env", NODE_ENV: "development" },
    assets: { directory: output, routerConfig: { has_user_worker: true } },
  });
  disposers.add(() => worker.dispose());
  await worker.ready;
  return (pathname: string) =>
    worker.dispatchFetch(`http://localhost${pathname}`, {
      headers: { "accept-encoding": "identity" },
    });
}

describe("an RSC build for Cloudflare Pages", () => {
  it("runs in workerd: it server-renders pages with React's production build and reads the worker's env", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    const root = await createApp();
    await buildApp(root);

    // Workers have no node_modules: the bundles include their packages.
    await expect(
      fs.access(path.join(root, OUTPUT, "_worker.js", "node_modules")),
    ).rejects.toThrow();

    const fetchWorker = await startWorker(root);
    const page = await fetchWorker("/");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("home");
    // React separates adjacent text with a comment.
    expect(html).toContain("<button>count <!-- -->0</button>");
    expect(html).toContain("<p>react production</p>");

    const secret = await fetchWorker("/api/secret");
    expect(secret.status).toBe(200);
    expect(await secret.json()).toEqual({ secret: "from the worker env" });
  }, 300_000);
});
