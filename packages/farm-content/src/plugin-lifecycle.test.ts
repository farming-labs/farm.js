import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collection, remote } from "./config.js";
import { content } from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  delete (globalThis as Record<string, unknown>)["__FARM_CONTENT_WRITE_RUNTIME__"];
});

const schema = { parse: (value: unknown) => value as Record<string, unknown> };

function fakeServer() {
  const sent: string[] = [];
  return {
    sent,
    server: {
      watcher: { on: vi.fn(), off: vi.fn() },
      moduleGraph: { getModulesByFile: () => [], invalidateModule: vi.fn() },
      ws: { send: (payload: { type: string }) => sent.push(payload.type) },
      httpServer: { once: vi.fn() },
    },
  };
}

describe("content plugin write lifecycle", () => {
  it("recovers the rebuild queue after a failed write refresh", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "farm-content-lifecycle-"));
    roots.push(root);

    let failNext = false;
    let fetches = 0;
    const documents = [{ id: "a", data: { title: "A" } }];
    const plugin = content({
      collections: {
        posts: collection({
          source: remote({
            name: "cms:posts",
            fetch: async () => {
              fetches += 1;
              if (failNext) {
                failNext = false;
                throw new Error("cms down");
              }
              return documents;
            },
          }),
          schema,
        }),
      },
    });

    const configured = await (plugin as any).configure({ root });
    const vitePlugin = configured.vite.plugins[0];
    const { server, sent } = fakeServer();
    vitePlugin.configureServer(server);

    const runtime = (globalThis as Record<string, any>)["__FARM_CONTENT_WRITE_RUNTIME__"];
    const afterWrite: () => Promise<void> = runtime.afterWrite;
    expect(afterWrite).toBeTypeOf("function");

    // First refresh fails: the CMS is down. The caller-facing promise must
    // settle (the dev overlay owns the report), and the stored queue must not
    // stay rejected.
    failNext = true;
    const fetchesBefore = fetches;
    await expect(afterWrite()).resolves.toBeUndefined();
    expect(sent).toContain("error");

    // Second refresh: the CMS is healthy again. On the buggy queue the stored
    // rejection swallowed this rebuild entirely - fetch never ran again.
    documents.push({ id: "b", data: { title: "B" } });
    await expect(afterWrite()).resolves.toBeUndefined();
    expect(fetches).toBeGreaterThan(fetchesBefore + 1);
    expect(sent).toContain("full-reload");
  });
});
