// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HmrContext, ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close().catch(() => {})));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function write(root: string, file: string, contents: string): Promise<string> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
  return target;
}

/** An islands app whose page renders a server component, a client component, and a helper. */
async function createProject(): Promise<string> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "farm-server-component-hmr-")),
  );
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
  await write(root, "package.json", '{"private":true,"type":"module"}');
  await write(
    root,
    "src/app/layout.tsx",
    `export default function Layout({ children }) { return <main>{children}</main>; }`,
  );
  await write(
    root,
    "src/app/page.tsx",
    `import { Generated } from "../../.farm/client-references/ui/Generated";
import { Footer } from "../components/footer";
import { Counter } from "../components/counter";
export default function Page() { return <article><Counter /><Generated /><Footer /></article>; }`,
  );
  await write(
    root,
    "src/components/footer.tsx",
    `export function Footer() { return <footer>footer v1</footer>; }`,
  );
  await write(
    root,
    "src/components/counter.tsx",
    `"use client";
export function Counter() { return <button>count</button>; }`,
  );
  await write(
    root,
    ".farm/client-references/ui/Generated.tsx",
    `"use client"; export function Generated() { return <button>generated reference</button>; }`,
  );
  await write(root, "src/lib/unused.ts", `export const unused = 1;`);
  return root;
}

describe("development server component HMR", () => {
  it("reloads the page and renders the edit when a server component it renders changes", async () => {
    const root = await createProject();
    const server = await createServer({
      root,
      images: { provider: "none" },
      experimental: { serverComponents: { mode: "islands" } },
      // Farm writes references under its project root even when Vite serves a different root.
      vite: { root: path.join(root, "src"), optimizeDeps: { noDiscovery: true, include: [] } },
    } as never);
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const page = () =>
      fetch(`http://localhost:${address.port}/`, { headers: { accept: "text/html" } }).then(
        (response) => response.text(),
      );
    expect(await page()).toContain("footer v1");

    // Drive the hook directly so watcher timing cannot race the assertions.
    await server.watcher.close();
    const handleHotUpdate = server.config.plugins.find(
      (plugin) => plugin.name === "farm",
    )?.handleHotUpdate;
    if (typeof handleHotUpdate !== "function") throw new Error("Missing Farm HMR handler");
    const hotUpdate = (file: string) =>
      handleHotUpdate({
        file,
        timestamp: Date.now(),
        modules: [...(server.moduleGraph.getModulesByFile(file) ?? [])],
        read: () => fs.readFile(file, "utf8"),
        server,
      } as HmrContext);
    const send = vi.spyOn(server.ws, "send");

    // Rendering loads generated client references into the server graph before a browser
    // requests them. Farm's own write must not tell the browser to reload the document.
    const reference = path.join(root, ".farm", "client-references", "ui", "Generated.tsx");
    expect(server.environments.ssr.moduleGraph.getModulesByFile(reference)?.size).toBeGreaterThan(
      0,
    );
    expect(server.environments.client.moduleGraph.getModulesByFile(reference)?.size ?? 0).toBe(0);
    await hotUpdate(reference);
    expect(send).not.toHaveBeenCalledWith({ type: "full-reload", path: "*" });

    const footer = path.join(root, "src", "components", "footer.tsx");
    // Islands mode keeps the server component out of the browser's module graph.
    expect(server.environments.client.moduleGraph.getModulesByFile(footer)?.size ?? 0).toBe(0);
    await fs.writeFile(footer, `export function Footer() { return <footer>footer v2</footer>; }`);
    expect(await hotUpdate(footer)).toEqual([]);
    expect(send).toHaveBeenCalledWith({ type: "full-reload", path: "*" });
    expect(await page()).toContain("footer v2");

    // A module no page renders is left to Vite.
    send.mockClear();
    const unused = path.join(root, "src", "lib", "unused.ts");
    await fs.writeFile(unused, `export const unused = 2;`);
    await hotUpdate(unused);
    expect(send).not.toHaveBeenCalledWith({ type: "full-reload", path: "*" });
  }, 60_000);
});
