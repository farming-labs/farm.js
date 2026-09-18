// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { describe, expect, it, vi } from "vitest";
import { farmPlugin } from "../vite";

async function writeCatalog(filePath: string, catalog: Record<string, string>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(catalog));
}

async function createDevServer(
  root: string,
  i18n: Record<string, unknown>,
): Promise<ViteDevServer> {
  return createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [farmPlugin({ root, i18n, images: { provider: "none" }, telemetry: false })],
    server: { middlewareMode: true },
  });
}

async function withTempRoot(action: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-i18n-watcher-"));
  try {
    await action(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function flushDebouncedTypeArtifactGeneration(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 200));
}

async function assertCatalogChangeTriggersFullReload(
  server: ViteDevServer,
  catalogFile: string,
): Promise<void> {
  const wsSend = vi.spyOn(server.ws, "send").mockImplementation(() => {});
  try {
    wsSend.mockClear();
    server.watcher.emit("change", catalogFile);
    await vi.waitFor(
      () => {
        expect(wsSend).toHaveBeenCalledWith({ type: "full-reload", path: "*" });
      },
      { timeout: 5000 },
    );
    await flushDebouncedTypeArtifactGeneration();
  } finally {
    wsSend.mockRestore();
    await server.close();
  }
}

describe("Farm dev server i18n catalog reload", () => {
  it("reloads and full-reloads when a {locale}-templated catalog changes", async () => {
    await withTempRoot(async (root) => {
      await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
      await writeCatalog(path.join(root, "content/locales/en/app.json"), { greeting: "Hello" });
      await writeCatalog(path.join(root, "content/locales/am/app.json"), { greeting: "Hello" });

      const server = await createDevServer(root, {
        locales: ["en", "am"],
        defaultLocale: "en",
        messages: "content/locales/{locale}/app.json",
      });
      await assertCatalogChangeTriggersFullReload(
        server,
        path.join(root, "content/locales/en/app.json"),
      );
    });
  });

  it("still reloads for the default flat catalog layout", async () => {
    await withTempRoot(async (root) => {
      await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
      await writeCatalog(path.join(root, "src/messages/en.json"), { greeting: "Hello" });
      await writeCatalog(path.join(root, "src/messages/am.json"), { greeting: "Hello" });

      const server = await createDevServer(root, {
        locales: ["en", "am"],
        defaultLocale: "en",
      });
      await assertCatalogChangeTriggersFullReload(server, path.join(root, "src/messages/en.json"));
    });
  });
});
