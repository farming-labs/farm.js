import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collection, content, files } from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-content-plugin-"));
  roots.push(root);
  await mkdir(path.join(root, "content"), { recursive: true });
  await writeFile(path.join(root, "content", "hello.md"), "---\ntitle: Hello\n---\nHello\n");
  return root;
}

function createPlugin() {
  return content({
    collections: {
      posts: collection({
        source: files("content/*.md"),
        schema: { parse: (value: unknown) => value as { title: string } },
      }),
    },
  });
}

describe("content plugin", () => {
  it("generates a physical server module and injects its Vite resolver first", async () => {
    const root = await createFixture();
    const plugin = createPlugin();
    const configured = await plugin.configure?.(
      {
        root,
        plugins: [plugin],
        vite: {
          optimizeDeps: { exclude: ["existing-package", "@farm.js/content/server"] },
          plugins: [{ name: "existing" }],
        },
      },
      { config: {} as never, isDev: true, isProd: false } as never,
    );
    const vitePlugin = (configured as any).vite.plugins[0];

    expect(vitePlugin.name).toBe("farm:content-runtime");
    expect((configured as any).vite.optimizeDeps.exclude).toEqual([
      "@farm.js/content/server",
      "existing-package",
    ]);
    expect(
      vitePlugin.resolveId.call(
        { environment: { name: "ssr" } },
        "@farm.js/content/server",
        "/app/src/page.tsx",
        { ssr: true },
      ),
    ).toBe(path.join(root, ".farm", "content", "server.mjs"));
    expect(() =>
      vitePlugin.resolveId.call(
        { environment: { name: "client" } },
        "@farm.js/content/server",
        "/app/src/client.tsx",
        { ssr: false },
      ),
    ).toThrow("server-only");
  });

  it("rebuilds and reloads when a content file changes", async () => {
    const root = await createFixture();
    const plugin = createPlugin();
    const configured = await plugin.configure?.({ root, plugins: [plugin] }, {
      config: {} as never,
      isDev: true,
      isProd: false,
    } as never);
    const vitePlugin = (configured as any).vite.plugins[0];
    let listener: ((event: string, file: string) => void) | undefined;
    const invalidateModule = vi.fn();
    const send = vi.fn();
    vitePlugin.configureServer({
      watcher: {
        on: (_event: string, callback: typeof listener) => {
          listener = callback;
        },
      },
      moduleGraph: {
        getModulesByFile: () => new Set([{}]),
        invalidateModule,
      },
      ws: { send },
      httpServer: null,
    });

    await writeFile(path.join(root, "content", "hello.md"), "---\ntitle: Updated\n---\nUpdated\n");
    listener?.("change", path.join(root, "content", "hello.md"));
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "full-reload" }));
    expect(invalidateModule).toHaveBeenCalledOnce();

    send.mockClear();
    invalidateModule.mockClear();
    await writeFile(path.join(root, "unrelated.md"), "# Not in a collection\n");
    listener?.("add", path.join(root, "unrelated.md"));
    await writeFile(path.join(root, "content", "second.md"), "---\ntitle: Second\n---\nSecond\n");
    listener?.("add", path.join(root, "content", "second.md"));

    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "full-reload" }));
    expect(send).toHaveBeenCalledOnce();
    expect(invalidateModule).toHaveBeenCalledOnce();
  });

  it("rejects duplicate plugin instances", async () => {
    const root = await createFixture();
    const plugin = createPlugin();
    const other = createPlugin();
    await expect(
      plugin.configure?.({ root, plugins: [plugin, other] }, {
        config: {} as never,
        isDev: true,
        isProd: false,
      } as never),
    ).rejects.toThrow("one content() plugin instance");
  });
});
