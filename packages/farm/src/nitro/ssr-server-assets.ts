import path from "path";
import type { Rollup } from "vite";
import { resolveBundleFileName, SERVER_FILE_URL_RE } from "./ssr-public-assets";

/**
 * Presets whose server runs without a filesystem: a Worker or edge function cannot read a file
 * from beside its bundle.
 */
const NO_FILESYSTEM_PRESETS = new Set([
  "cloudflare",
  "cloudflare-pages",
  "cloudflare-module",
  "vercel-edge",
  "netlify-edge",
]);

/**
 * Cloudflare Workers also refuse to compile WebAssembly from bytes ("Wasm code generation
 * disallowed by embedder"), so inlining a module into the bundle cannot work there either.
 */
const CLOUDFLARE_PRESETS = new Set(["cloudflare", "cloudflare-pages", "cloudflare-module"]);

const SERVER_CODE_FILE_RE = /\.[cm]?js$/;

/**
 * Fail the build when a preset without a filesystem would deploy server code that reads one of
 * its assets from disk. The server would otherwise crash when it loads the module.
 */
export function assertServerFileAssetsDeployable(
  preset: string,
  serverFileAssets: ReadonlySet<string>,
): void {
  if (serverFileAssets.size === 0 || !NO_FILESYSTEM_PRESETS.has(preset)) return;
  const assets = [...serverFileAssets].sort();
  const wasmCount = assets.filter((fileName) => fileName.toLowerCase().endsWith(".wasm")).length;
  const lines = [
    `[farm] The ${preset} preset cannot deploy files that server code reads from disk: ${assets.join(", ")}.`,
    `Server code reads ${assets.length === 1 ? "it" : "them"} with readFile(new URL(..., import.meta.url)), the code Vite emits for a server import of a .wasm module, and a ${preset} server has no filesystem.`,
  ];
  if (wasmCount > 0 && CLOUDFLARE_PRESETS.has(preset)) {
    lines.push(
      "Cloudflare Workers also refuse to compile WebAssembly from bytes, so inlining the module (as @farm.js/wasm does) cannot run there either.",
    );
  }
  if (wasmCount < assets.length) {
    lines.push("Import other files with ?inline so their contents ship inside the server bundle.");
  }
  lines.push(
    "To keep the server code as written, build for a preset with a filesystem: node-server, bun, vercel, or netlify.",
  );
  throw new Error(lines.join("\n"));
}

async function listServerCodeFiles(
  directory: string,
  fs: typeof import("fs/promises"),
): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      // Copied runtime packages (sharp, @vercel/og) resolve their own files.
      if (entry.isDirectory()) {
        return entry.name === "node_modules" ? [] : listServerCodeFiles(entryPath, fs);
      }
      return entry.isFile() && SERVER_CODE_FILE_RE.test(entry.name) ? [entryPath] : [];
    }),
  );
  return files.flat();
}

/**
 * Copy each asset server code reads beside the chunk that reads it, in a server output that was
 * bundled again from the SSR bundle (Nitro's rebundle). That pass moves the reading code into its
 * own chunks but keeps each `new URL("<relative path>", import.meta.url)` as written for the SSR
 * bundle's layout, and does not emit the file it names.
 *
 * Returns the output-relative paths written.
 */
export async function copyServerFileAssetsBesideChunks(
  bundle: Rollup.OutputBundle,
  serverFileAssets: ReadonlySet<string>,
  serverDir: string,
  fs: typeof import("fs/promises"),
): Promise<string[]> {
  if (serverFileAssets.size === 0) return [];
  // Vite names emitted assets by content hash, so a file name identifies the asset.
  const assetsByName = new Map<string, Rollup.OutputAsset>();
  for (const fileName of serverFileAssets) {
    const output = bundle[fileName];
    if (output?.type === "asset") assetsByName.set(path.posix.basename(fileName), output);
  }

  const targets = new Map<string, Rollup.OutputAsset>();
  for (const filePath of await listServerCodeFiles(serverDir, fs)) {
    const code = await fs.readFile(filePath, "utf8");
    if (!code.includes("import.meta.url")) continue;
    const chunkFileName = path.relative(serverDir, filePath).split(path.sep).join("/");
    for (const [, , relativeUrl] of code.matchAll(SERVER_FILE_URL_RE)) {
      let name = path.posix.basename(relativeUrl.replace(/[?#].*$/, ""));
      try {
        name = decodeURI(name);
      } catch {
        // Keep the literal name; it simply will not match an emitted asset.
      }
      const asset = assetsByName.get(name);
      if (!asset) continue;
      const target = resolveBundleFileName(chunkFileName, relativeUrl);
      if (!target) {
        throw new Error(
          `[farm] ${chunkFileName} reads ${asset.fileName} from ${relativeUrl}, which is outside the server output ${serverDir}. Import the file with ?inline to ship it inside the server bundle.`,
        );
      }
      targets.set(target, asset);
    }
  }

  await Promise.all(
    [...targets].map(async ([target, asset]) => {
      const targetPath = path.join(serverDir, ...target.split("/"));
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, asset.source);
    }),
  );
  return [...targets.keys()].sort();
}
