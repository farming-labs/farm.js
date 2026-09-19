// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startDevServer } from "../server/create-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => fs.rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

async function createProject(logPath: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-failed-start-"));
  temporaryRoots.add(root);

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
  images: { provider: "none" },
  // Without strictPort Vite quietly moves to the next free port, so listen()
  // would succeed and there would be no failure to clean up after.
  plugins: [
    {
      name: "failed-start-disposer",
      setup(context) {
        context.lifecycle.onShutdown(() => {
          writeFileSync(${JSON.stringify(logPath)}, "disposed");
        });
      },
      runtime: {
        start() {
          throw new Error("runtime start failed");
        },
        close() {},
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

  return root;
}

describe("development server failed startup", () => {
  it("releases plugin resources when startup fails after createServer", async () => {
    const logPath = path.join(os.tmpdir(), `farm-failed-start-${process.pid}.log`);
    await fs.rm(logPath, { force: true });
    const root = await createProject(logPath);

    // createServer has already opened watchers, instrumentation, and plugin
    // resources by the time startup fails, and the caller never receives the
    // server, so nothing else can close them.
    await expect(startDevServer({ root, images: { provider: "none" } }, 0)).rejects.toThrow(
      /runtime start failed/,
    );

    // The disposer registered during setup must have run.
    await expect(fs.readFile(logPath, "utf8")).resolves.toBe("disposed");
    await fs.rm(logPath, { force: true });
  }, 60_000);
});
