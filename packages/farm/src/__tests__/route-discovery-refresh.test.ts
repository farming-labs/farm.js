import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APIRouteManager } from "../api/route-manager";
import { RouteManager } from "../routing/route-manager";
import type { FarmConfig } from "../types";

// A dev server discovers routes again whenever a watcher reports a page, layout, or route file,
// while it keeps serving requests. These tests pin what a request sees during that discovery.

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function createRoot(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-route-discovery-"));
  temporaryRoots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), contents);
  }
  return root;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

describe("page route discovery", () => {
  const page = "export default function Page() { return null; }\n";

  it("keeps matching the current routes while it discovers them again", async () => {
    const root = await createRoot({ "src/app/page.tsx": page });
    const manager = new RouteManager({ root, srcDir: "src" } as Required<FarmConfig>);
    await manager.discoverRoutes();
    expect(manager.matchRoute("/").route?.pattern).toBe("/");

    const rediscovery = manager.discoverRoutes();
    // A request handled before the scan finishes, as in a dev server while a watcher event's
    // refresh awaits the file system.
    expect(manager.matchRoute("/").route?.pattern).toBe("/");
    await rediscovery;
    expect(manager.matchRoute("/").route?.pattern).toBe("/");
  });

  it("adopts the new routes when discovery finishes and keeps the old ones when it fails", async () => {
    const root = await createRoot({ "src/app/page.tsx": page });
    const manager = new RouteManager({ root, srcDir: "src" } as Required<FarmConfig>);
    await manager.discoverRoutes();

    await fs.mkdir(path.join(root, "src/app/about"), { recursive: true });
    await fs.writeFile(path.join(root, "src/app/about/page.tsx"), page);
    await manager.discoverRoutes();
    expect(manager.matchRoute("/about").route?.pattern).toBe("/about");

    // Two modules for one page: discovery throws, and the dev server reports the failed refresh.
    await fs.writeFile(path.join(root, "src/app/about/page.jsx"), page);
    await expect(manager.discoverRoutes()).rejects.toThrow('Duplicate page route "/about"');
    expect(manager.matchRoute("/").route?.pattern).toBe("/");
    expect(manager.matchRoute("/about").route?.pattern).toBe("/about");
  });
});

describe("API route discovery", () => {
  async function createApiManager(load: () => Promise<Record<string, unknown>>) {
    const root = await createRoot({
      "api/ping/route.ts": "export const GET = () => new Response('pong');\n",
    });
    const viteServer = { environments: { ssr: { runner: { import: load } } } };
    return new APIRouteManager(root, viteServer as any);
  }

  it("keeps matching the current routes while a route module loads", async () => {
    let load = () => Promise.resolve<Record<string, unknown>>({ GET: () => new Response() });
    const manager = await createApiManager(() => load());
    await manager.discoverRoutes();

    const loading = deferred<void>();
    const pending = deferred<Record<string, unknown>>();
    load = () => {
      loading.resolve();
      return pending.promise;
    };
    const rediscovery = manager.discoverRoutes();
    await loading.promise;
    expect(manager.matchRoute("/api/ping")?.route.path).toBe("/api/ping");

    pending.resolve({ GET: () => new Response(), POST: () => new Response() });
    await rediscovery;
    expect(manager.matchRoute("/api/ping")?.route.methods).toEqual(["GET", "POST"]);
  });

  it("runs one discovery at a time so an older scan cannot replace a newer one", async () => {
    const loads: Array<ReturnType<typeof deferred<Record<string, unknown>>>> = [];
    const manager = await createApiManager(() => {
      const load = deferred<Record<string, unknown>>();
      loads.push(load);
      return load.promise;
    });

    const older = manager.discoverRoutes();
    const newer = manager.discoverRoutes();
    await expect.poll(() => loads.length).toBe(1);
    // The newer discovery has not started loading while the older one waits on its module.
    await new Promise((resolve) => setImmediate(resolve));
    expect(loads).toHaveLength(1);

    loads[0]!.resolve({ GET: () => new Response() });
    await older;
    await expect.poll(() => loads.length).toBe(2);
    loads[1]!.resolve({ GET: () => new Response(), DELETE: () => new Response() });
    await newer;
    expect(manager.matchRoute("/api/ping")?.route.methods).toEqual(["GET", "DELETE"]);
  });
});
