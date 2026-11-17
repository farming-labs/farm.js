// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

/**
 * A PPR shell is rendered and then stored. The production server stamped it with the cache's
 * version at the moment it was stored, so a revalidatePath() that landed while the page was still
 * rendering counted as older than the shell: the shell holding the old data was stored as fresh
 * and served on every later request.
 *
 * The page blocks after reading its data until the update endpoint has changed the data and
 * revalidated the path, so the race happens on every run without a timer.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-ppr-revalidate-during-render-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false, experimental: { ppr: true } };`,
    "src/app/layout.tsx":
      "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
    // The first render waits, after reading the value, until the update has run.
    "src/lib/store.ts": `const g = globalThis as any;
g.__value ??= 1;
export const read = () => g.__value;
export function pauseFirstRender(): Promise<void> {
  if (g.__paused) return Promise.resolve();
  g.__paused = true;
  g.__onRenderPaused?.();
  return new Promise((resolve) => { g.__resumeRender = resolve; });
}
export async function update(value: number): Promise<void> {
  if (!g.__paused) await new Promise((resolve) => { g.__onRenderPaused = resolve; });
  g.__value = value;
}
export const resumeRender = () => g.__resumeRender?.();`,
    "src/app/pricing/page.tsx": `import { pauseFirstRender, read } from "../../lib/store";
export const experimental_ppr = true;
export default async function Pricing() {
  const value = read();
  await pauseFirstRender();
  return <main id="value">{"value:" + value}</main>;
}`,
    "src/app/api/update/route.ts": `import { revalidatePath } from "@farm.js/core/cache";
import { resumeRender, update } from "../../../lib/store";
export async function POST() {
  await update(2);
  await revalidatePath("/pricing");
  resumeRender();
  return Response.json({ ok: true });
}`,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

describe("revalidatePath() while a PPR page renders", () => {
  it("leaves the shell it raced stale in production", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    try {
      const raced = fetch(`${server.origin}/pricing`).then((response) => response.text());
      const updated = await fetch(`${server.origin}/api/update`, { method: "POST" });
      expect(updated.status).toBe(200);
      // The render that read the value before the update finishes with it, as documented.
      expect(await raced).toMatch(/value:(<!-- -->)?1/);

      // The next request renders again instead of serving that shell.
      const next = await fetch(`${server.origin}/pricing`);
      expect(next.headers.get("x-farm-ppr")).toBe("miss");
      expect(await next.text()).toMatch(/value:(<!-- -->)?2/);
      const cached = await fetch(`${server.origin}/pricing`);
      expect(cached.headers.get("x-farm-ppr")).toBe("hit");
      expect(await cached.text()).toMatch(/value:(<!-- -->)?2/);
    } finally {
      await server.stop();
    }
  }, 240_000);
});
