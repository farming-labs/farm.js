// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Plugin, ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
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

async function createProject(): Promise<string> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-server-stylesheets-")),
  );
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(
    await fs.realpath(packageRoot),
    path.join(root, "node_modules", "@farm.js", "core"),
    "junction",
  );
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(root, "src/app/globals.css", ".globals-marker { color: rgb(1, 2, 3); }\n");
  await writeModule(root, "src/styles/vendor.css", ".vendor-marker { color: rgb(4, 5, 6); }\n");
  await writeModule(root, "src/styles/inline.css", ".inline-marker { color: rgb(7, 8, 9); }\n");
  await writeModule(root, "src/app/card.module.css", ".card { color: rgb(10, 11, 12); }\n");
  await writeModule(
    root,
    "src/app/layout.tsx",
    `import "./globals.css";
import "../styles/vendor.css";
export default function Layout({ children }) { return <main>{children}</main>; }`,
  );
  await writeModule(
    root,
    "src/app/page.tsx",
    `import styles from "./card.module.css";
import inlineCss from "../styles/inline.css?inline";
export default function Page() {
  return <><style>{inlineCss}</style><div className={styles.card}>Card</div></>;
}`,
  );
  return root;
}

describe("development stylesheets in the server environment", () => {
  it("skips compiling plain stylesheets the server drops, and keeps every stylesheet the page uses", async () => {
    const root = await createProject();
    // Runs after Vite's CSS compile, before the CSS becomes a module.
    const compiled: Array<{ consumer: string; id: string; code: string }> = [];
    const recordCompiledCss: Plugin = {
      name: "test:record-compiled-css",
      transform(code, id) {
        if (!/\.css(?:$|\?)/.test(id)) return;
        compiled.push({ consumer: this.environment.config.consumer, id, code });
      },
    };
    const server = await createServer({
      root,
      images: { provider: "none" },
      vite: { optimizeDeps: { noDiscovery: true, include: [] }, plugins: [recordCompiledCss] },
    } as never);
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    const html = await (await fetch(`${origin}/`)).text();
    // A CSS module's class names and an inline import's CSS come from the server's compile.
    expect(html).toMatch(/class="_card_[\w-]+"/);
    expect(html).toContain(".inline-marker");
    // Plain stylesheets reach the browser as links, the one imported from JS included.
    expect(html).toContain('href="/src/app/globals.css"');
    expect(html).toContain('href="/src/styles/vendor.css"');

    const serverCss = (file: string) =>
      compiled.find(({ consumer, id }) => consumer === "server" && id === path.join(root, file));
    expect(serverCss("src/app/globals.css")?.code).toBe("");
    expect(serverCss("src/styles/vendor.css")?.code).toBe("");
    expect(serverCss("src/app/card.module.css")?.code).toContain("color: rgb(10, 11, 12)");

    const globals = await (await fetch(`${origin}/src/app/globals.css`)).text();
    expect(globals).toContain(".globals-marker");
  }, 60_000);
});
