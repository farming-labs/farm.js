// @vitest-environment node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { FARM_VIDEO_PLAYER_PATH } from "../metadata";
import {
  FARM_NITRO_STATIC_HANDLER_SOURCE,
  createNitroStaticRangePlugin,
} from "../nitro/static-range";
import { startProductionServer } from "./production-server";
import { FARM_VIDEO_PLAYER_HTML } from "../video-player";

const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clip = Uint8Array.from({ length: 4096 }, (_, index) => index % 251);

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-static-range-"));

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.mkdir(path.join(root, "public", "videos"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default { srcDir: "src", images: { provider: "none" } };`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `export default function HomePage() { return <main>static-range-home</main>; }`,
  );
  await fs.writeFile(path.join(root, "public", "videos", "clip.mp4"), clip);

  return root;
}

async function readBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

describe("production static files and byte ranges", () => {
  // node-server reuses the prebuilt SSR bundle; bun has Nitro bundle it again.
  it.for([
    { preset: "node-server", command: process.execPath },
    { preset: "bun", command: "bun" },
  ])(
    "answers Range requests for public files ($preset)",
    async ({ preset, command }, ctx) => {
      if (preset === "bun" && !hasBun) ctx.skip();
      const root = await createFixture();
      let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;

      try {
        const userConfig = await loadConfig(root, undefined, "production");
        await build(await resolveConfig({ ...userConfig, root }, "production"), { root, preset });
        production = await startProductionServer(path.join(root, ".farm", ".output", "server"), {
          command,
        });
        const url = `${production.origin}/videos/clip.mp4`;

        const full = await fetch(url);
        expect(full.status).toBe(200);
        expect(full.headers.get("accept-ranges")).toBe("bytes");
        expect(await readBytes(full)).toEqual(clip);
        const etag = full.headers.get("etag");
        expect(etag).toBeTruthy();

        // Safari and iOS Messages open a video with this probe and play nothing on a 200.
        const probe = await fetch(url, { headers: { range: "bytes=0-1" } });
        expect(probe.status).toBe(206);
        expect(probe.headers.get("content-range")).toBe("bytes 0-1/4096");
        expect(probe.headers.get("content-length")).toBe("2");
        expect(await readBytes(probe)).toEqual(clip.subarray(0, 2));

        const middle = await fetch(url, { headers: { range: "bytes=1000-1999" } });
        expect(middle.status).toBe(206);
        expect(middle.headers.get("content-range")).toBe("bytes 1000-1999/4096");
        expect(await readBytes(middle)).toEqual(clip.subarray(1000, 2000));

        const openEnded = await fetch(url, { headers: { range: "bytes=4000-" } });
        expect(openEnded.status).toBe(206);
        expect(openEnded.headers.get("content-range")).toBe("bytes 4000-4095/4096");
        expect(await readBytes(openEnded)).toEqual(clip.subarray(4000));

        const suffix = await fetch(url, { headers: { range: "bytes=-96" } });
        expect(suffix.status).toBe(206);
        expect(suffix.headers.get("content-range")).toBe("bytes 4000-4095/4096");

        const pastEnd = await fetch(url, { headers: { range: "bytes=1000-99999" } });
        expect(pastEnd.status).toBe(206);
        expect(pastEnd.headers.get("content-range")).toBe("bytes 1000-4095/4096");

        const unsatisfiable = await fetch(url, { headers: { range: "bytes=4096-" } });
        expect(unsatisfiable.status).toBe(416);
        expect(unsatisfiable.headers.get("content-range")).toBe("bytes */4096");
        await unsatisfiable.arrayBuffer();

        // Several ranges, or a validator that no longer matches, get the whole file.
        const multiple = await fetch(url, { headers: { range: "bytes=0-1,4-5" } });
        expect(multiple.status).toBe(200);
        expect(await readBytes(multiple)).toEqual(clip);

        const staleIfRange = await fetch(url, {
          headers: { range: "bytes=0-1", "if-range": '"stale"' },
        });
        expect(staleIfRange.status).toBe(200);
        expect(await readBytes(staleIfRange)).toEqual(clip);

        const currentIfRange = await fetch(url, {
          headers: { range: "bytes=0-1", "if-range": etag! },
        });
        expect(currentIfRange.status).toBe(206);
        await currentIfRange.arrayBuffer();

        const head = await fetch(url, { method: "HEAD", headers: { range: "bytes=0-1" } });
        expect(head.status).toBe(200);
        expect(head.headers.get("accept-ranges")).toBe("bytes");
        expect(head.headers.get("content-length")).toBe("4096");

        const page = await fetch(production.origin, { headers: { range: "bytes=0-1" } });
        expect(page.status).toBe(200);
        await expect(page.text()).resolves.toContain("static-range-home");

        const player = await fetch(`${production.origin}${FARM_VIDEO_PLAYER_PATH}`);
        expect(player.status).toBe(200);
        await expect(player.text()).resolves.toBe(FARM_VIDEO_PLAYER_HTML);
      } finally {
        await production?.stop();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
});

describe("createNitroStaticRangePlugin", () => {
  it("replaces only Nitro's static handler, until Nitro's own answers ranges", async () => {
    const nitroDir = await fs.mkdtemp(path.join(packageRoot, ".tmp-nitro-static-range-"));
    const runtimeDir = path.join(nitroDir, "dist", "runtime");
    const handlerFile = path.join(runtimeDir, "internal", "static.mjs");

    try {
      await fs.mkdir(path.dirname(handlerFile), { recursive: true });
      await fs.writeFile(handlerFile, "export default () => {};");
      const plugin = createNitroStaticRangePlugin(path.join(runtimeDir, "nitro.mjs"));
      const load = (plugin.load as { handler: (id: string) => string | null }).handler;

      expect(load(handlerFile)).toBe(FARM_NITRO_STATIC_HANDLER_SOURCE);
      expect(load(`${handlerFile}?import`)).toBe(FARM_NITRO_STATIC_HANDLER_SOURCE);
      expect(load(path.join(nitroDir, "app", "internal", "static.mjs"))).toBeNull();

      await fs.writeFile(handlerFile, 'event.res.headers.set("Accept-Ranges", "bytes");');
      expect(load(handlerFile)).toBeNull();
    } finally {
      await fs.rm(nitroDir, { recursive: true, force: true });
    }
  });
});
