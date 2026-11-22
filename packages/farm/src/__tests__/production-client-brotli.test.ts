// @vitest-environment node

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-client-brotli-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default ${JSON.stringify({ srcDir: "src", images: { provider: "none" }, telemetry: false })};\n`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "globals.css"),
    Array.from({ length: 60 }, (_, i) => `.row-${i} { padding: ${i}px; }`).join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `import "./globals.css";\nexport default function Layout({ children }) { return <html><body>{children}</body></html>; }\n`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "counter.tsx"),
    `"use client";
import { useState } from "react";
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `import Counter from "./counter";\nexport default function Page() { return <main>client-brotli<Counter /></main>; }\n`,
  );
  return root;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).replace(/\\/g, "/"),
    );
}

/** The response's own bytes: fetch would decode them and hide what the server sent. */
function get(origin: string, pathname: string, acceptEncoding?: string) {
  return new Promise<{ encoding: string | undefined; body: Buffer }>((resolve, reject) => {
    const request = http.get(
      `${origin}${pathname}`,
      { headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {} },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            encoding: response.headers["content-encoding"],
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
  });
}

describe("client scripts and stylesheets on a node-server build", () => {
  // production-owned-response covers how a script is sent for each Accept-Encoding.
  it("get a brotli copy of their final bytes, the stylesheet pages link included", async () => {
    const root = await createFixture();
    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "node-server" });

      const publicDir = path.join(root, ".farm", ".output", "public");
      const files = await listFiles(publicDir);
      const entry = files.find((file) => /^farm-client-h[0-9a-f]+\.js$/.test(file));
      // Written after the client build, from the stylesheet as the SSR build left it.
      const stylesheet = files.find((file) => /^assets\/farm-client-h[0-9a-f]+\.css$/.test(file));
      expect(entry).toBeDefined();
      expect(stylesheet).toBeDefined();
      for (const file of [entry!, stylesheet!]) expect(files).toContain(`${file}.br`);

      const copies = files.filter((file) => file.endsWith(".br"));
      expect(copies.every((file) => /\.(?:m?js|css)\.br$/.test(file))).toBe(true);
      for (const copy of copies) {
        const original = await fs.readFile(path.join(publicDir, copy.slice(0, -3)));
        const compressed = await fs.readFile(path.join(publicDir, copy));
        expect(brotliDecompressSync(compressed).equals(original), copy).toBe(true);
      }

      const production = await startProductionServer(path.join(root, ".farm", ".output", "server"));
      try {
        const html = await (await fetch(`${production.origin}/`)).text();
        expect(html).toContain(`/${stylesheet}`);
        const sent = await get(production.origin, `/${stylesheet}`, "gzip, deflate, br, zstd");
        expect(sent.encoding).toBe("br");
        const original = await fs.readFile(path.join(publicDir, stylesheet!));
        expect(brotliDecompressSync(sent.body).equals(original)).toBe(true);
      } finally {
        await production.stop();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
