// @vitest-environment node

import fs from "node:fs/promises";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyPrismaClientForVercel } from "../nitro/universal-build";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function writeFile(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

/** A pnpm-style store entry: the client package with the generated client beside it. */
async function createPrismaStore(
  root: string,
): Promise<{ nodeModules: string; clientDir: string }> {
  const nodeModules = path.join(root, "store", "@prisma+client@6.7.0", "node_modules");
  const clientDir = path.join(nodeModules, "@prisma", "client");
  await writeFile(
    path.join(clientDir, "package.json"),
    JSON.stringify({ name: "@prisma/client", version: "6.7.0" }),
  );
  await writeFile(path.join(clientDir, "default.js"), "module.exports = {};");
  await writeFile(path.join(nodeModules, ".prisma", "client", "index.js"), "module.exports = {};");
  return { nodeModules, clientDir };
}

async function createTemporaryRoot(): Promise<string> {
  // Outside the workspace, so no parent node_modules holds a real Prisma client.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "farm-vercel-prisma-")));
  temporaryRoots.push(root);
  return root;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

function setNodePath(value: string | undefined): void {
  if (value === undefined) delete process.env.NODE_PATH;
  else process.env.NODE_PATH = value;
  // Node reads NODE_PATH once at startup; re-read it as a process started with it would.
  (Module as unknown as { _initPaths(): void })._initPaths();
}

describe("Vercel output copies the app's own Prisma client", () => {
  it("does not copy a Prisma client the app only reaches through NODE_PATH", async () => {
    const root = await createTemporaryRoot();
    const store = await createPrismaStore(root);
    const app = path.join(root, "app");
    const functionDir = path.join(root, "function");
    await writeFile(path.join(app, "package.json"), '{"private":true}');
    await fs.mkdir(functionDir, { recursive: true });

    // pnpm sets NODE_PATH to its store for every script it runs, such as `pnpm build`.
    const previousNodePath = process.env.NODE_PATH;
    setNodePath(store.nodeModules);
    try {
      // The lookup the copy used to rely on finds the store's client.
      expect(
        createRequire(path.join(app, "package.json")).resolve("@prisma/client/default.js"),
      ).toBe(path.join(store.clientDir, "default.js"));

      await copyPrismaClientForVercel(app, functionDir, fs);
    } finally {
      setNodePath(previousNodePath);
    }

    expect(await fs.readdir(functionDir)).toEqual([]);
  });

  it("copies a Prisma client the app installed, with the generated client beside it", async () => {
    const root = await createTemporaryRoot();
    const store = await createPrismaStore(root);
    const app = path.join(root, "app");
    const functionDir = path.join(root, "function");
    await writeFile(path.join(app, "package.json"), '{"private":true}');
    await fs.mkdir(path.join(app, "node_modules", "@prisma"), { recursive: true });
    // pnpm links the app's dependency to its store entry.
    await fs.symlink(
      store.clientDir,
      path.join(app, "node_modules", "@prisma", "client"),
      "junction",
    );
    await fs.mkdir(functionDir, { recursive: true });

    await copyPrismaClientForVercel(app, functionDir, fs);

    expect(
      await exists(path.join(functionDir, "node_modules", "@prisma", "client", "default.js")),
    ).toBe(true);
    expect(
      await exists(path.join(functionDir, "node_modules", ".prisma", "client", "index.js")),
    ).toBe(true);
    const functionPackage = JSON.parse(
      await fs.readFile(path.join(functionDir, "package.json"), "utf8"),
    );
    expect(functionPackage.dependencies).toEqual({ "@prisma/client": "6.7.0" });
  });

  it("copies a Prisma client a workspace hoisted above the app", async () => {
    const root = await createTemporaryRoot();
    const workspaceModules = path.join(root, "workspace", "node_modules");
    await writeFile(
      path.join(workspaceModules, "@prisma", "client", "package.json"),
      JSON.stringify({ name: "@prisma/client", version: "6.7.0" }),
    );
    await writeFile(path.join(workspaceModules, ".prisma", "client", "index.js"), "");
    const app = path.join(root, "workspace", "apps", "web");
    const functionDir = path.join(root, "function");
    await writeFile(path.join(app, "package.json"), '{"private":true}');
    await fs.mkdir(functionDir, { recursive: true });

    await copyPrismaClientForVercel(app, functionDir, fs);

    expect(
      await exists(path.join(functionDir, "node_modules", "@prisma", "client", "package.json")),
    ).toBe(true);
    expect(
      await exists(path.join(functionDir, "node_modules", ".prisma", "client", "index.js")),
    ).toBe(true);
  });
});
