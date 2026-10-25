// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { layoutsCanCoverSamePage } from "../routing/layout-selector";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function write(root: string, file: string, source: string) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), source);
}

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-server-layout-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await write(root, "package.json", JSON.stringify({ private: true, type: "module" }));
  await write(
    root,
    "farm.config.ts",
    `export default { srcDir: "src", images: { provider: "none" } };`,
  );
  await write(
    root,
    "src/app/layout.tsx",
    `export default function RootLayout({ children }) {
  return <html><body><p>ROOT_LAYOUT_ANCESTOR_MARKER</p>{children}</body></html>;
}`,
  );
  await write(
    root,
    "src/app/page.tsx",
    `"use client";
import { useState } from "react";
export default function Home() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}`,
  );
  await write(
    root,
    "src/lib/server-secret.ts",
    `export function loadServerSecret() { return "SERVER_LAYOUT_SECRET_4b1f"; }`,
  );
  await write(
    root,
    "src/app/admin/layout.tsx",
    `import { loadServerSecret } from "../../lib/server-secret";
export default function AdminLayout({ children }) {
  return <section data-secret={loadServerSecret()}>{children}</section>;
}`,
  );
  await write(
    root,
    "src/app/admin/page.tsx",
    `export default function AdminPage() { return <main>admin</main>; }`,
  );
  await write(
    root,
    "src/app/shop/layout.tsx",
    `"use client";
import { useState } from "react";
export default function ShopLayout({ children }) {
  const [open, setOpen] = useState(false);
  return <section><button onClick={() => setOpen(!open)}>CLIENT_LAYOUT_MARKER_7c2e</button>{children}</section>;
}`,
  );
  await write(
    root,
    "src/app/shop/page.tsx",
    `export default function ShopPage() { return <main>shop</main>; }`,
  );
  return root;
}

async function readPublicJavaScript(root: string): Promise<string> {
  const publicDir = path.join(root, ".farm", ".output", "public");
  const files = await fs.readdir(publicDir, { recursive: true });
  const sources = await Promise.all(
    files
      .filter((file) => String(file).endsWith(".js"))
      .map((file) => fs.readFile(path.join(publicDir, String(file)), "utf8")),
  );
  return sources.join("\n");
}

describe("server-only layouts in the client entry", () => {
  it("keeps a server layout and its imports out of the public client output", async () => {
    const root = await createFixture();
    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "node-server" });

      const client = await readPublicJavaScript(root);
      expect(client.includes("SERVER_LAYOUT_SECRET_4b1f")).toBe(false);
      expect(client.includes("CLIENT_LAYOUT_MARKER_7c2e")).toBe(true);
      // The client renders a hydrating layout's whole chain, ancestors included.
      expect(client.includes("ROOT_LAYOUT_ANCESTOR_MARKER")).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});

describe("layoutsCanCoverSamePage", () => {
  it("pairs a layout with its ancestors and descendants only", () => {
    expect(layoutsCanCoverSamePage("/", "/shop")).toBe(true);
    expect(layoutsCanCoverSamePage("/shop/cart", "/shop")).toBe(true);
    expect(layoutsCanCoverSamePage("/admin", "/shop")).toBe(false);
    expect(layoutsCanCoverSamePage("/admin/users", "/shop")).toBe(false);
  });

  it("treats dynamic segments as matching any URL segment", () => {
    expect(layoutsCanCoverSamePage("/[lang]", "/shop")).toBe(true);
    expect(layoutsCanCoverSamePage("/shop/[id]", "/[lang]/cart")).toBe(true);
    expect(layoutsCanCoverSamePage("/[...slug]", "/a/b/c")).toBe(true);
    expect(layoutsCanCoverSamePage("/admin/[id]", "/shop/[id]")).toBe(false);
  });

  it("keeps grouped layouts to their own group", () => {
    expect(layoutsCanCoverSamePage("/(marketing)", "/(shop)")).toBe(false);
    expect(layoutsCanCoverSamePage("/(shop)", "/(shop)/cart")).toBe(true);
    expect(layoutsCanCoverSamePage("/", "/(shop)")).toBe(true);
    expect(layoutsCanCoverSamePage("/(marketing)", "/shop")).toBe(true);
  });
});
