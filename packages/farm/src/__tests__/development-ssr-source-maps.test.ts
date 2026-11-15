// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRunnableDevEnvironment,
  type RunnableDevEnvironment,
  type ViteDevServer,
} from "vite";
import { createServer } from "../server/create-server";
import type { FarmConfig } from "../types";
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

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

async function startApp(vite?: FarmConfig["vite"]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-source-maps-"));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(
    root,
    "src/app/page.tsx",
    `import React from "react";
export default function Page() { return <main>home</main>; }`,
  );
  // TypeScript types and blank lines shift the compiled code, so only a mapped stack names line 9.
  await writeModule(
    root,
    "src/app/api/stack/route.ts",
    `interface Probe {
  label: string;
}

type Probes = Probe[];

export async function GET(): Promise<Response> {
  const probes: Probes = [{ label: "stack" }];
  return new Response(new Error(probes[0]!.label).stack);
}`,
  );

  const server = await createServer({
    root,
    images: { provider: "none" },
    ...(vite ? { vite } : {}),
  });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return { server, origin: `http://localhost:${address.port}` };
}

describe("development SSR source maps", () => {
  it("maps app stack traces through the runner instead of Node's process-wide source maps", async () => {
    const { server, origin } = await startApp();

    const response = await fetch(`${origin}/api/stack`);
    const stack = await response.text();

    expect(response.status).toBe(200);
    expect(stack).toMatch(/src\/app\/api\/stack\/route\.ts:9:\d+/);
    const runner = (server.environments.ssr as RunnableDevEnvironment).runner;
    // Vite stores "prepareStackTrace" as its resolved interceptor; the default is "node".
    expect(runner.options.sourcemapInterceptor).toEqual({ retrieveFile: expect.any(Function) });
  }, 60_000);

  it("keeps an SSR environment that the app's Vite config creates", async () => {
    const { server } = await startApp({
      environments: {
        ssr: {
          dev: {
            createEnvironment: (name, config) =>
              createRunnableDevEnvironment(name, config, {
                runnerOptions: { sourcemapInterceptor: false },
              }),
          },
        },
      },
    });

    const runner = (server.environments.ssr as RunnableDevEnvironment).runner;
    expect(runner.options.sourcemapInterceptor).toBe(false);
  }, 60_000);
});
