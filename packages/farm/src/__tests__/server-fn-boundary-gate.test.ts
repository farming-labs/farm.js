// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { farmPlugin } from "../vite";
import { logger } from "../utils";

const serverFnModule = `
import { createServerFn } from "@farm.js/core/server-fn";
export const save = createServerFn({ async handler() { return { ok: true }; } });
`;

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function transformForClient(options: {
  serverActions: boolean;
  vitePlugins: string[];
}): Promise<string | undefined> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-server-fn-gate-"));
  roots.push(root);
  const plugin = farmPlugin({
    root,
    images: { provider: "none" },
    ...(options.serverActions ? { experimental: { serverActions: true } } : {}),
  } as any) as any;
  await plugin.configResolved.call(
    {},
    {
      root,
      command: "build",
      mode: "production",
      plugins: options.vitePlugins.map((name) => ({ name })),
    },
  );
  let boundaryError: string | undefined;
  const context = {
    error(message: string) {
      boundaryError = message;
      throw new Error(message);
    },
    warn() {},
  };
  try {
    await plugin.transform.call(context, serverFnModule, path.join(root, "src/actions.ts"), {
      ssr: false,
    });
  } catch (error) {
    if (!boundaryError) throw error;
  }
  return boundaryError;
}

describe("server-function client boundary", () => {
  it("rejects a server function bundled into the client by default", async () => {
    expect(await transformForClient({ serverActions: false, vitePlugins: [] })).toContain(
      "createServerFn handlers run only on the server",
    );
  });

  it("still rejects it when experimental.serverActions is set without the RSC transform", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    expect(await transformForClient({ serverActions: true, vitePlugins: [] })).toContain(
      "createServerFn handlers run only on the server",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "experimental.serverActions has no effect without @farm.js/plugin/rsc",
      ),
    );
  });

  it("leaves client imports to the RSC transform when it is installed", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    expect(
      await transformForClient({
        serverActions: true,
        vitePlugins: ["@farm.js/plugin/rsc:server-fn-actions"],
      }),
    ).toBeUndefined();
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("has no effect"));
  });
});
