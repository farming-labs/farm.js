// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close().catch(() => {})));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) => fs.rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

/**
 * Build a project whose plugin records disposal into a file, so the assertion
 * observes real cleanup rather than a mock the test controls.
 */
async function createProject(pluginBody: string): Promise<{ root: string; log: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-close-"));
  temporaryRoots.add(root);
  const log = path.join(root, "dispose.log");

  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const dependency of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", dependency)),
      path.join(root, "node_modules", dependency),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `import { writeFileSync } from "node:fs";
export default {
  plugins: [
    {
      name: "disposer",
      setup(context) {
        ${pluginBody}
      },
    },
  ],
};`,
  );
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `import React from "react";
export default function Layout({ children }) {
  return <>{children}</>;
}`,
  );

  return { root, log };
}

describe("development server close lifecycle", () => {
  it("awaits plugin disposers before close() resolves", async () => {
    const { root, log } = await createProject(
      `context.lifecycle.onShutdown(async () => {
          await new Promise((resolve) => setTimeout(resolve, 150));
          writeFileSync(${JSON.stringify("__LOG__")}, "disposed");
        });`,
    );
    // Inject the absolute log path after the template is written.
    const configPath = path.join(root, "farm.config.ts");
    const config = await fs.readFile(configPath, "utf8");
    await fs.writeFile(configPath, config.replace("__LOG__", log.replace(/\\/g, "\\\\")));

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);

    await server.close();

    // A slow disposer must have finished by the time close() resolves.
    await expect(fs.readFile(log, "utf8")).resolves.toBe("disposed");
  }, 60_000);

  it("surfaces a failing plugin disposer to the caller", async () => {
    const { root } = await createProject(
      `context.lifecycle.onShutdown(() => {
          throw new Error("queue drain failed");
        });`,
    );

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);

    // The failure must not vanish into an event listener.
    await expect(server.close()).rejects.toThrow(/queue drain failed|shutdown failed/i);
  }, 60_000);
});
