// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withoutNodePath } from "./without-node-path";

const VERCEL_OG_HINT = 'Install "@vercel/og" to render OG and metadata images: pnpm add @vercel/og';

describe("@vercel/og as an optional peer", () => {
  afterEach(() => {
    vi.doUnmock("@vercel/og");
    vi.resetModules();
  });

  it("names the install command when a JSX metadata image renders without @vercel/og", async () => {
    vi.resetModules();
    vi.doMock("@vercel/og", () => {
      throw Object.assign(
        new Error("Cannot find package '@vercel/og' imported from /app/node_modules/x.mjs"),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
    });
    const { createFarmMetadataImageResponse } = await import("../metadata-image");

    await expect(createFarmMetadataImageResponse(<div>card</div>, {})).rejects.toThrow(
      `Rendering a metadata image from JSX needs @vercel/og, which is not installed. ${VERCEL_OG_HINT}`,
    );
    // SVG and byte metadata images never load @vercel/og.
    const svg = await createFarmMetadataImageResponse("<svg />", {});
    expect(svg.status).toBe(200);
  });

  it("explains an API route that imports @farm.js/core/og without @vercel/og", async () => {
    const { explainMissingOptionalPeer } = await import("../optional-peer");
    const missing = Object.assign(
      new Error(
        "Cannot find package '@vercel/og' imported from /app/node_modules/@farm.js/core/dist/og.mjs",
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    const explained = explainMissingOptionalPeer(missing, "route /app/src/app/api/card/route.tsx");
    expect(explained).toBeInstanceOf(Error);
    expect((explained as Error).message).toBe(
      `route /app/src/app/api/card/route.tsx needs @vercel/og, which is not installed. ${VERCEL_OG_HINT}`,
    );
    expect((explained as Error).cause).toBe(missing);

    const other = new Error("boom");
    expect(explainMissingOptionalPeer(other, "route x")).toBe(other);
  });

  it("skips copying @vercel/og into the server output when the app does not install it", async () => {
    // Core's shared runtime keeps a lazy @vercel/og import, so the server output
    // can reference it in apps that never render a JSX metadata image.
    const { copyMetadataImageRuntime } = await import("../nitro/universal-build");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-og-copy-"));
    const serverDir = path.join(root, ".farm/.output/server");

    try {
      await fs.writeFile(path.join(root, "package.json"), "{}");
      await fs.mkdir(serverDir, { recursive: true });

      await withoutNodePath(() => copyMetadataImageRuntime(root, serverDir, fs));
      await expect(fs.stat(path.join(serverDir, "node_modules/@vercel/og"))).rejects.toThrow();

      // With the package installed (core's own install), it is copied beside the server.
      await copyMetadataImageRuntime(process.cwd(), serverDir, fs);
      await expect(
        fs.stat(path.join(serverDir, "node_modules/@vercel/og/package.json")),
      ).resolves.toBeTruthy();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails the build before bundling a generated metadata image without @vercel/og", async () => {
    const { assertMetadataImageRuntimeInstalled } = await import("../nitro/universal-build");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-og-build-"));
    const routes = [
      { sourceType: "static" as const },
      { sourceType: "module" as const, modulePath: path.join(root, "src/app/opengraph-image.tsx") },
    ];

    try {
      await fs.writeFile(path.join(root, "package.json"), "{}");

      await withoutNodePath(() => {
        expect(() => assertMetadataImageRuntimeInstalled(root, routes)).toThrow(
          `src/app/opengraph-image.tsx renders with @vercel/og, which is not installed. ${VERCEL_OG_HINT}`,
        );
        // Static images and apps without metadata images do not need it.
        expect(() => assertMetadataImageRuntimeInstalled(root, [routes[0]!])).not.toThrow();
        expect(() => assertMetadataImageRuntimeInstalled(root, [])).not.toThrow();
      });
      // Core's own install resolves it.
      expect(() => assertMetadataImageRuntimeInstalled(process.cwd(), routes)).not.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
