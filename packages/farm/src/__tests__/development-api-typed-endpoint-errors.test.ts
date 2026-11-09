// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const devServers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...devServers].map((server) => server.close()));
  devServers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

async function linkPackage(root: string, name: string, target: string): Promise<void> {
  const link = path.join(root, "node_modules", ...name.split("/"));
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.symlink(await fs.realpath(target), link, "junction");
}

/**
 * Install `@farm.js/core` as a package manager would: a real directory under `node_modules`
 * holding the published files, not a symlink into the workspace. Its own dependencies resolve
 * from the workspace's install.
 */
async function installPackageCopy(root: string): Promise<void> {
  const installed = path.join(root, "node_modules", "@farm.js", "core");
  await fs.mkdir(installed, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  await fs.copyFile(path.join(packageRoot, "package.json"), path.join(installed, "package.json"));
  for (const entry of manifest.files as string[]) {
    await fs.cp(path.join(packageRoot, entry), path.join(installed, entry), { recursive: true });
  }
  await fs.symlink(
    await fs.realpath(path.join(packageRoot, "node_modules")),
    path.join(installed, "node_modules"),
    "junction",
  );
}

/**
 * An app with `@farm.js/core` either linked from the workspace, as every app in `examples/` is,
 * or installed as a real copy, as an app installed from npm has it. When linked, the route
 * imports its own copy of `@farm.js/core/api` through Vite's SSR runner in development, while the
 * API runtime that catches the failure is core's Node copy.
 */
async function createTypedErrorFixture(
  renderer: "react" | false,
  core: "linked" | "installed" = "linked",
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-typed-endpoint-errors-"));
  temporaryRoots.add(root);
  if (core === "installed") await installPackageCopy(root);
  else await linkPackage(root, "@farm.js/core", packageRoot);
  await linkPackage(root, "zod", path.join(packageRoot, "node_modules", "zod"));
  if (renderer === "react") {
    for (const name of ["react", "react-dom"]) {
      await linkPackage(root, name, path.join(packageRoot, "node_modules", name));
    }
    await writeModule(
      root,
      "src/app/layout.tsx",
      `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
    );
    await writeModule(
      root,
      "src/app/page.tsx",
      `import React from "react";
export default function Page() { return <main>home</main>; }`,
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(
    root,
    "src/app/api/typed/route.ts",
    `import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";

export const GET = createEndpoint(
  {
    query: z.object({ id: z.string().optional() }),
    errors: {
      notFound: { status: 404, message: "Nope", data: z.object({ id: z.string() }) },
    },
  },
  async ({ query, error }) => (query.id === "found" ? { id: query.id } : error("notFound", { id: "1" })),
);
`,
  );
  await writeModule(
    root,
    "src/app/api/unexpected/route.ts",
    `import { createEndpoint } from "@farm.js/core/api";

export const GET = createEndpoint({}, async () => {
  // Looks like a typed failure but was not raised by \`error()\`: it must stay private.
  throw Object.assign(new Error("secret detail"), {
    name: "EndpointFailure",
    code: "notFound",
    status: 404,
    data: { leaked: true },
  });
});
`,
  );
  return root;
}

/** The contract both the development server and the production server must answer. */
async function expectTypedEndpointResponses(origin: string): Promise<void> {
  const failed = await fetch(`${origin}/api/typed`);
  expect(failed.status).toBe(404);
  expect(failed.headers.get("content-type")).toMatch(/^application\/json/);
  await expect(failed.json()).resolves.toEqual({
    error: { code: "notFound", message: "Nope", data: { id: "1" } },
  });

  const found = await fetch(`${origin}/api/typed?id=found`);
  expect(found.status).toBe(200);
  await expect(found.json()).resolves.toEqual({ id: "found" });

  const unexpected = await fetch(`${origin}/api/unexpected`);
  expect(unexpected.status).toBe(500);
  const body = await unexpected.text();
  expect(body).not.toContain("secret detail");
  expect(body).not.toContain("leaked");
}

describe("typed endpoint errors through the app runtime", () => {
  it.each([
    ["the default React renderer", "react" as const],
    ["renderer: false", false as const],
  ])(
    "answer the declared status in development with %s",
    async (_label, renderer) => {
      const root = await createTypedErrorFixture(renderer);
      const server = await createServer({
        root,
        ...(renderer === false ? { renderer: false } : {}),
        images: { provider: "none" },
      });
      devServers.add(server);
      await server.listen(await getAvailablePort());
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Missing dev server address");

      await expectTypedEndpointResponses(`http://localhost:${address.port}`);
    },
    60_000,
  );

  it("answer the declared status in development with @farm.js/core installed from npm", async () => {
    const root = await createTypedErrorFixture(false, "installed");
    // Start the dev server from the installed copy, as `farm dev` in that app does, so the
    // runtime catching the failure and the route's `@farm.js/core/api` come from the same package.
    await fs.writeFile(
      path.join(root, "dev.mjs"),
      `import { createServer } from "@farm.js/core/server";

const server = await createServer({ root: process.cwd(), renderer: false, images: { provider: "none" } });
await server.listen(Number(process.env.PORT));
console.log("FARM_DEV_READY");
`,
    );
    const port = await getAvailablePort();
    const processOutput: string[] = [];
    const devServer = spawn(process.execPath, ["dev.mjs"], {
      cwd: root,
      env: { ...process.env, NODE_PATH: "", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<void>((resolve) => devServer.once("exit", () => resolve()));
    const ready = new Promise<boolean>((resolve) => {
      devServer.stdout.on("data", (chunk) => {
        processOutput.push(String(chunk));
        if (processOutput.join("").includes("FARM_DEV_READY")) resolve(true);
      });
      devServer.once("exit", () => resolve(false));
    });
    devServer.stderr.on("data", (chunk) => processOutput.push(String(chunk)));

    try {
      expect(await ready, processOutput.join("")).toBe(true);

      await expectTypedEndpointResponses(`http://localhost:${port}`);
    } finally {
      if (devServer.exitCode === null) devServer.kill();
      await exited;
    }
  }, 60_000);

  it("answer the same declared status from a production server", async () => {
    const root = await createTypedErrorFixture(false);
    const config = await resolveConfig({ root, renderer: false }, "production");
    await build(config, { root, preset: "node-server" });

    const output = path.join(root, ".farm", ".output");
    const port = await getAvailablePort();
    const processOutput: string[] = [];
    const productionServer = spawn(process.execPath, [path.join(output, "server", "index.mjs")], {
      cwd: path.join(output, "server"),
      env: { ...process.env, NODE_PATH: "", HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    productionServer.stdout.on("data", (chunk) => processOutput.push(String(chunk)));
    productionServer.stderr.on("data", (chunk) => processOutput.push(String(chunk)));
    const exited = new Promise<void>((resolve) => productionServer.once("exit", () => resolve()));

    try {
      const origin = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let attempt = 0; attempt < 200 && !ready; attempt++) {
        if (productionServer.exitCode !== null) break;
        ready = await fetch(`${origin}/_farm/health/ready`).then(
          (response) => response.ok,
          () => false,
        );
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(ready, processOutput.join("")).toBe(true);

      await expectTypedEndpointResponses(origin);
    } finally {
      if (productionServer.exitCode === null) productionServer.kill();
      await exited;
    }
  }, 180_000);
});
