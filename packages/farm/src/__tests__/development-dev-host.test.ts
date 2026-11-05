// @vitest-environment node
import fs from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import type { FarmUserConfig } from "../config";
import { startDevServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  for (const server of servers) await server.close();
  servers.clear();
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

/** Loopback addresses this machine can bind; a container without IPv6 has only 127.0.0.1. */
async function bindableLoopbacks(): Promise<string[]> {
  const addresses: string[] = [];
  for (const host of ["127.0.0.1", "::1"]) {
    const probe = createNetServer();
    const ok = await new Promise<boolean>((resolve) => {
      probe.once("error", () => resolve(false));
      probe.listen(0, host, () => resolve(true));
    });
    if (ok) await new Promise((resolve) => probe.close(resolve));
    addresses.push(...(ok ? [host] : []));
  }
  return addresses;
}

async function createProject(): Promise<FarmUserConfig> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-host-")));
  roots.push(root);
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
    "export default function Page() { return <main>dev host</main>; }",
  );
  return {
    root,
    images: { provider: "none" },
    vite: {
      plugins: [
        {
          name: "dev-host-test",
          configureServer: {
            order: "pre",
            handler(server) {
              servers.add(server);
              server.middlewares.use("/ping", (_req, res) => res.end("pong"));
            },
          },
        },
      ],
    },
  };
}

function lanAddress(): string | undefined {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return undefined;
}

function urlHost(address: string) {
  return address.includes(":") ? `[${address}]` : address;
}

async function ping(address: string, port: number): Promise<string> {
  const response = await fetch(`http://${urlHost(address)}:${port}/ping`);
  return response.text();
}

function boundAddress(server: ViteDevServer) {
  const address = server.httpServer?.address();
  if (!address || typeof address !== "object") throw new Error("dev server is not listening");
  return address;
}

/** Vite's HMR socket, opened through the given address. Resolves on Vite's `connected` message. */
function openHmrSocket(server: ViteDevServer, address: string, port: number): Promise<void> {
  const url = `ws://${urlHost(address)}:${port}/?token=${server.config.webSocketToken}`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, "vite-hmr");
    socket.addEventListener("message", (event) => {
      if (JSON.parse(String(event.data)).type === "connected") {
        socket.close();
        resolve();
      }
    });
    socket.addEventListener("error", () => reject(new Error(`HMR socket failed on ${url}`)));
  });
}

describe("farm dev host", () => {
  it("answers on both loopback addresses by default, across restarts, and never on the LAN", async () => {
    const loopbacks = await bindableLoopbacks();
    const port = await getAvailablePort();
    const server = await startDevServer(await createProject(), port);

    // `localhost` resolves to one family; the server binds that one and accepts the other too.
    expect(loopbacks).toContain(boundAddress(server).address);
    for (const restart of [false, true]) {
      if (restart) await server.restart();
      for (const address of loopbacks) {
        expect(await ping(address, port)).toBe("pong");
        await openHmrSocket(server, address, port);
      }
    }
    expect(server.resolvedUrls?.network ?? []).toEqual([]);
    const lan = lanAddress();
    if (lan) await expect(ping(lan, port)).rejects.toThrow();
  });

  it("listens on every interface with host: true", async () => {
    const port = await getAvailablePort();
    const server = await startDevServer(await createProject(), port, { host: true });

    expect(["::", "0.0.0.0"]).toContain(boundAddress(server).address);
    for (const address of await bindableLoopbacks()) {
      expect(await ping(address, port)).toBe("pong");
    }
  });

  it("binds only the address it is given", async () => {
    const port = await getAvailablePort();
    const server = await startDevServer(await createProject(), port, { host: "127.0.0.1" });

    expect(boundAddress(server).address).toBe("127.0.0.1");
    expect(await ping("127.0.0.1", port)).toBe("pong");
    if ((await bindableLoopbacks()).includes("::1")) {
      await expect(ping("::1", port)).rejects.toThrow();
    }
  });
});
