// @vitest-environment node

import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { definePlugin } from "../plugin";
import { createServer, startDevServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];
const servers: ViteDevServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => {})));
  for (const root of roots.splice(0)) {
    Reflect.deleteProperty(globalThis, Symbol.for(root));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

/** An app whose page records when it renders, in the event list the test reads. */
async function createProject(): Promise<{ root: string; events: string[] }> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "farm-deferred-dev-")));
  roots.push(root);
  const events: string[] = [];
  Reflect.set(globalThis, Symbol.for(root), events);
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
    path.join(root, "src", "app", "layout.tsx"),
    "export default function Layout({ children }) { return <>{children}</>; }",
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `export default function Page() {
  globalThis[Symbol.for(${JSON.stringify(root)})].push("render");
  return <main>deferred page</main>;
}`,
  );
  return { root, events };
}

/** A plugin that holds Farm's dev setup open inside `routesGenerated` until `release` resolves. */
function holdSetup(events: string[], release: Promise<void>, failure?: unknown) {
  return definePlugin({
    name: "test:hold-dev-setup",
    async routesGenerated() {
      events.push("setup-held");
      await release;
      events.push("setup-released");
      if (failure !== undefined) throw failure;
    },
    onError(event) {
      events.push(`onError:${event.phase}`);
    },
  });
}

/** Resolves once `port` accepts a connection: the server is listening. */
async function connects(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "localhost");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForListening(port: number, starting: Promise<unknown>): Promise<void> {
  let settled = false;
  void starting.then(
    () => (settled = true),
    () => (settled = true),
  );
  while (!(await connects(port))) {
    if (settled) throw new Error("startDevServer settled before the port opened");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("deferred development setup", () => {
  it("opens the port before Farm's setup finishes and answers waiting requests after it", async () => {
    const { root, events } = await createProject();
    const release = Promise.withResolvers<void>();
    const port = await getAvailablePort();
    const starting = startDevServer({ root, plugins: [holdSetup(events, release.promise)] }, port);

    await expect.poll(() => events, { timeout: 30_000 }).toContain("setup-held");
    await waitForListening(port, starting);
    events.push("listening");
    // The setup is still held: the request waits at Farm's place in the middleware stack.
    const response = fetch(`http://localhost:${port}/`);
    events.push("released");
    release.resolve();

    const server = await starting;
    servers.push(server);
    const page = await response;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("deferred page");
    expect(events).toEqual(["setup-held", "listening", "released", "setup-released", "render"]);
  }, 60_000);

  it("reports a setup failure once, closes the port, and answers waiting requests with it", async () => {
    const { root, events } = await createProject();
    const release = Promise.withResolvers<void>();
    const failure = new Error("setup failed after the port opened");
    const port = await getAvailablePort();
    const starting = startDevServer(
      { root, plugins: [holdSetup(events, release.promise, failure)] },
      port,
    );

    await expect.poll(() => events, { timeout: 30_000 }).toContain("setup-held");
    await waitForListening(port, starting);
    const response = fetch(`http://localhost:${port}/`);
    release.resolve();

    await expect(starting).rejects.toBe(failure);
    const waiting = await response.catch((error: unknown) => error);
    if (waiting instanceof Response) expect(waiting.status).toBe(500);
    expect(events).toEqual(["setup-held", "setup-released", "onError:createServer"]);
    expect(await connects(port)).toBe(false);
  }, 60_000);

  it("keeps createServer resolving only after Farm's setup", async () => {
    const { root, events } = await createProject();
    const release = Promise.withResolvers<void>();
    const creating = createServer({ root, plugins: [holdSetup(events, release.promise)] }).then(
      (server) => {
        events.push("created");
        return server;
      },
    );
    // routesGenerated runs inside the setup, so createServer is still pending once it is held.
    await expect.poll(() => events, { timeout: 30_000 }).toContain("setup-held");
    events.push("released");
    release.resolve();
    servers.push(await creating);
    expect(events).toEqual(["setup-held", "released", "setup-released", "created"]);
  }, 60_000);
});
