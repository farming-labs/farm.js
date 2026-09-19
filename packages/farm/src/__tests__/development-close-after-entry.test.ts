// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../server/create-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => fs.rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

async function createProject(logPath: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-close-after-entry-"));
  temporaryRoots.add(root);

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  for (const dependency of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", dependency)),
      path.join(root, "node_modules", dependency),
      "junction",
    );
  }
  await fs.symlink(
    await fs.realpath(packageRoot),
    path.join(root, "node_modules", "@farm.js", "core"),
    "junction",
  );
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `import { writeFileSync } from "node:fs";
export default {
  images: { provider: "none" },
  plugins: [
    {
      name: "close-marker",
      setup(context) {
        context.lifecycle.onShutdown(() => {
          writeFileSync(${JSON.stringify(logPath)}, "disposed");
        });
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

describe("development server close after the client entry transform", () => {
  it("close() resolves and farm teardown completes even when Vite's close wedges (#1263)", async () => {
    const logPath = path.join(os.tmpdir(), `farm-close-after-entry-${process.pid}.log`);
    await fs.rm(logPath, { force: true });
    const root = await createProject(logPath);

    // Default configuration: transforming the entry starts dependency
    // discovery, the exact state in which Vite 5.4's close() deadlocks.
    const server = await createServer({ root, images: { provider: "none" } });
    await server.listen(0);
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    await fetch(`http://localhost:${address.port}/@farm/client`).then((r) => r.text());

    const startedAt = Date.now();
    await server.close();
    const elapsed = Date.now() - startedAt;

    // Bounded: the Vite hang is abandoned at the timeout instead of hanging
    // the caller forever.
    expect(elapsed).toBeLessThan(20_000);
    // Farm's own teardown still ran to completion.
    await expect(fs.readFile(logPath, "utf8")).resolves.toBe("disposed");
    // Nothing is still serving.
    await expect(fetch(`http://localhost:${address.port}/`)).rejects.toThrow();
    await fs.rm(logPath, { force: true });
  }, 60_000);
});
