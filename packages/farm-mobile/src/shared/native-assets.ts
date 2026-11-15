import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { MobileGeneratedFile } from "@farm.js/core/mobile";

/**
 * The images and other files React Native screens `require()`, as Metro wrote them for the OS
 * (`MobileNativeScreens.assetsDir`), placed under `dir` in the native project with their relative
 * paths, sorted. React Native finds them there in a build: Android by resource name in
 * `res/drawable-<density>/`, iOS by path in `assets/` next to the bytecode. Empty without any.
 */
export async function createNativeAssetFiles(
  assetsDir: string | undefined,
  dir: string,
): Promise<MobileGeneratedFile[]> {
  if (!assetsDir) return [];
  const entries = await readdir(assetsDir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(assetsDir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      path: `${dir}/${file}`,
      contents: new Uint8Array(await readFile(path.join(assetsDir, file))),
    })),
  );
}
