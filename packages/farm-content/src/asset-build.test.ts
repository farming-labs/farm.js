import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build, createServer, type InlineConfig } from "vite";
import { asset, collection, content, files } from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "farm-content-asset-build-"));
  roots.push(root);
  const names = ["guide#v1.pdf", "guide%23v1.pdf", "folder#1/space name.pdf", "plain.pdf"];
  if (process.platform !== "win32") names.push("guide?v1.pdf");
  for (const [index, name] of names.entries()) {
    const file = path.join(root, "content", name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from([0, 255, 128, index, 10]));
  }
  const references = names.map(
    (name) => "./" + name.split("/").map(encodeURIComponent).join("/") + "?download=1#page=2",
  );
  await writeFile(
    path.join(root, "content", "post.md"),
    `---json\n${JSON.stringify({ downloads: references })}\n---\n${references.map((ref) => `[Download](${ref})`).join("\n")}`,
  );
  const entry = path.join(root, "entry.js");
  await writeFile(entry, 'export { getEntryOrThrow } from "@farm.js/content/server";');
  const plugin = content({
    collections: {
      posts: collection({
        source: files("content/post.md"),
        schema: { parse: () => ({}) },
        assets: { downloads: asset.files() },
      }),
    },
  });
  const configured = await plugin.configure?.(
    { root, plugins: [plugin] },
    {
      config: {} as never,
      isDev: true,
      isProd: false,
    },
  );
  const config: InlineConfig = {
    root,
    configFile: false,
    logLevel: "silent",
    base: "/app/",
    plugins: (configured as any).vite.plugins,
    resolve: {
      alias: {
        "@farm.js/content/internal/runtime": fileURLToPath(
          new URL("./runtime.ts", import.meta.url),
        ),
      },
    },
    css: { postcss: { plugins: [] } },
    optimizeDeps: { noDiscovery: true },
  };
  return { root, entry, config, names };
}

describe("content asset Vite output", () => {
  it("builds reserved filenames with base paths, suffixes, and exact emitted bytes", async () => {
    const { root, entry, config, names } = await fixture();
    const outDir = path.join(root, "dist");
    await build({
      ...config,
      build: {
        ssr: entry,
        outDir,
        emptyOutDir: false,
        ssrEmitAssets: true,
        assetsInlineLimit: 0,
        rollupOptions: { output: { entryFileNames: "entry.mjs" } },
      },
    });
    const built = await import(
      /* @vite-ignore */ pathToFileURL(path.join(outDir, "entry.mjs")).href
    );
    const post = await built.getEntryOrThrow("posts", "post");
    for (const [index, download] of post.data.downloads.entries()) {
      expect(download.name).toBe(path.basename(names[index]));
      expect(download.src).toMatch(/^\/app\/assets\/.+\.pdf\?download=1#page=2$/);
      const pathname = new URL(download.src, "http://localhost").pathname.slice("/app/".length);
      expect(await readFile(path.join(outDir, decodeURIComponent(pathname)))).toEqual(
        Buffer.from([0, 255, 128, index, 10]),
      );
      expect(post.body).toContain(download.src);
    }
  });

  it("serves reserved asset bytes in development and reloads after a source edit", async () => {
    const { root, entry, config } = await fixture();
    const server = await createServer({ ...config, server: { port: 0, host: "127.0.0.1" } });
    try {
      await server.listen();
      const address = server.httpServer!.address() as { port: number };
      const load = async () => (await server.ssrLoadModule(entry)).getEntryOrThrow("posts", "post");
      const before = await load();
      const response = await fetch(
        `http://127.0.0.1:${address.port}${before.data.downloads[0].src}`,
      );
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0, 255, 128, 0, 10]));
      const source = path.join(root, "content", "guide#v1.pdf");
      await writeFile(source, Buffer.from([0, 255, 128, 42, 10]));
      await expect
        .poll(async () => (await load()).data.downloads[0].src)
        .not.toBe(before.data.downloads[0].src);
      const after = await load();
      const updated = await fetch(`http://127.0.0.1:${address.port}${after.data.downloads[0].src}`);
      expect(Buffer.from(await updated.arrayBuffer())).toEqual(Buffer.from([0, 255, 128, 42, 10]));
    } finally {
      await server.close();
    }
  });
});
