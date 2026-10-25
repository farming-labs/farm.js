// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatOptionalPeerInstallHint, isMissingPackageError } from "../optional-peer";

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn() },
}));

vi.mock("../utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils")>()),
  logger,
}));

async function importMissingFrom(directory: string, specifier: string): Promise<unknown> {
  const file = path.join(directory, "importer.mjs");
  await writeFile(file, `export default () => import(${JSON.stringify(specifier)});\n`);
  const { default: load } = await import(/* @vite-ignore */ pathToFileURL(file).href);
  return load().then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("optional peer dependencies", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "farm-optional-peer-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("recognizes Node's error for the missing package and its subpaths", async () => {
    const error = await importMissingFrom(directory, "@farm-missing/optional-peer");
    const subpathError = await importMissingFrom(directory, "@farm-missing/optional-peer/server");

    expect(isMissingPackageError(error, "@farm-missing/optional-peer")).toBe(true);
    expect(isMissingPackageError(subpathError, "@farm-missing/optional-peer")).toBe(true);
  });

  it("does not mistake a missing dependency of the package for the package", async () => {
    const error = await importMissingFrom(directory, "@farm-missing/optional-peer-binary");

    expect(isMissingPackageError(error, "@farm-missing/optional-peer")).toBe(false);
    expect(isMissingPackageError(new Error("boom"), "@farm-missing/optional-peer")).toBe(false);
    expect(isMissingPackageError(undefined, "@farm-missing/optional-peer")).toBe(false);
  });

  it("names the install command", () => {
    expect(formatOptionalPeerInstallHint("sharp", "optimize images")).toBe(
      'Install "sharp" to optimize images: pnpm add sharp',
    );
    expect(
      formatOptionalPeerInstallHint("@tailwindcss/vite", "enable Tailwind", { dev: true }),
    ).toBe('Install "@tailwindcss/vite" to enable Tailwind: pnpm add -D @tailwindcss/vite');
  });
});

describe("built-in Tailwind support", () => {
  beforeEach(() => {
    vi.resetModules();
    logger.info.mockClear();
    logger.warn.mockClear();
  });

  function missingTailwind() {
    return Object.assign(
      new Error("Cannot find package '@tailwindcss/vite' imported from /app/node_modules/x.mjs"),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
  }

  it("loads the installed Tailwind plugin", async () => {
    const { loadTailwindVitePlugin } = await import("../build/tailwind");
    const plugin = { name: "@tailwindcss/vite:scan" };

    await expect(
      loadTailwindVitePlugin({ announce: true }, async () => ({ default: () => [plugin] })),
    ).resolves.toEqual([plugin]);
    expect(logger.info).toHaveBeenCalledWith(
      "📦 Enabled built-in Tailwind support (@tailwindcss/vite)",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("continues without Tailwind and warns once when a stylesheet imports it", async () => {
    const { loadTailwindVitePlugin } = await import("../build/tailwind");
    const plugin = (await loadTailwindVitePlugin({}, async () => {
      throw missingTailwind();
    })) as {
      name: string;
      configResolved(config: { root: string }): void;
      transform(code: string, id: string): unknown;
    };

    expect(plugin.name).toBe("farm:tailwind-missing");
    expect(logger.warn).not.toHaveBeenCalled();

    plugin.configResolved({ root: "/app" });
    expect(plugin.transform("body { margin: 0 }", "/app/src/plain.css")).toBeNull();
    expect(plugin.transform('import "tailwindcss";', "/app/src/page.tsx")).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();

    expect(
      plugin.transform('@import "tailwindcss";', "/app/src/app/globals.css?direct"),
    ).toBeNull();
    expect(plugin.transform('@import "tailwindcss";', "/app/src/app/other.css")).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'src/app/globals.css imports Tailwind CSS, but @tailwindcss/vite is not installed; continuing without Tailwind. Install "@tailwindcss/vite" to enable built-in Tailwind CSS support: pnpm add -D @tailwindcss/vite',
    );
  });

  it("keeps the existing warning for other Tailwind load failures", async () => {
    const { loadTailwindVitePlugin } = await import("../build/tailwind");

    await expect(
      loadTailwindVitePlugin({ label: "for SSR" }, async () => {
        throw new Error("oxide binary failed to load");
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "Tailwind plugin auto-enable failed for SSR; continuing without it: oxide binary failed to load",
    );
  });
});
