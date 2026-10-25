// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

it.each([false, true])(
  "finishes a background optimizer write before cancelling (holdUntilCrawlEnd: %s)",
  async (holdUntilCrawlEnd) => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "farm-close-optimizer-")),
    );
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const events: string[] = [];
    let writing = false;
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
      for (const name of ["react", "react-dom"]) {
        await fs.symlink(
          await fs.realpath(path.join(packageRoot, "node_modules", name)),
          path.join(root, "node_modules", name),
          "junction",
        );
      }
      await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
      await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        "export default function Page() { return <main>ready</main>; }",
      );

      server = await createServer({
        root,
        images: { provider: "none" },
        vite: {
          optimizeDeps: {
            holdUntilCrawlEnd,
            rolldownOptions: {
              plugins: [
                {
                  name: "hold-optimizer-write",
                  async generateBundle(options) {
                    if (!options.dir?.includes("deps_temp_")) return;
                    writing = true;
                    started.resolve();
                    await release.promise;
                  },
                  writeBundle(options) {
                    if (options.dir?.includes("deps_temp_")) events.push("written");
                  },
                  closeBundle() {
                    if (writing) finished.resolve();
                  },
                },
              ],
            },
          },
        },
      });
      await server.listen(await getAvailablePort());
      await started.promise;
      const optimizer = server.environments.client.depsOptimizer!;
      const closeOptimizer = optimizer.close.bind(optimizer);
      optimizer.close = async () => {
        events.push("optimizer-close");
        await closeOptimizer();
      };

      // No transform is pending: this is the independent background optimizer.
      const closing = server.close();
      release.resolve();
      await closing;
      await finished.promise;
      expect(events).toEqual(["written", "optimizer-close"]);
    } finally {
      release.resolve();
      await server?.close();
      if (writing) await finished.promise;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  },
  60_000,
);
