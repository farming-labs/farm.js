import path from "path";
import type { Rollup } from "vite";
import { getFarmPresetRuntime } from "../deployment";

/**
 * A server file reference: `new URL("<relative path>", import.meta.url)`. Vite renders an asset
 * this way for a server consumer when server code reads the emitted file from its own output
 * directory instead of linking to it (its SSR WebAssembly helper reads the bytes with `readFile`).
 * Quotes vary once a later pass reprints the code.
 */
const SERVER_FILE_URL_RE = /new\s+URL\(\s*(["'`])([^"'`\\]+)\1\s*,\s*import\.meta\.url\s*\)/g;

function resolveBundleFileName(chunkFileName: string, relativeUrl: string): string | null {
  // A root-relative path or another scheme resolves away from the chunk's own directory.
  if (relativeUrl.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(relativeUrl)) return null;
  let relativePath = relativeUrl.replace(/[?#].*$/, "");
  try {
    relativePath = decodeURI(relativePath);
  } catch {
    // Keep the literal path; it simply will not match an emitted file.
  }
  const fileName = path.posix.normalize(
    path.posix.join(path.posix.dirname(chunkFileName), relativePath),
  );
  return fileName.startsWith("../") ? null : fileName;
}

/** Replace each server file reference in a chunk of `bundle` that names an asset it emitted. */
function replaceServerFileReferences(
  bundle: Rollup.OutputBundle,
  chunkFileName: string,
  code: string,
  replace: (assetFileName: string) => string,
): string {
  return code.replace(SERVER_FILE_URL_RE, (reference, _quote: string, relativeUrl: string) => {
    const target = resolveBundleFileName(chunkFileName, relativeUrl);
    return target && bundle[target]?.type === "asset" ? replace(target) : reference;
  });
}

/** Every SSR asset server code reads through a server file reference, public or not. */
export function collectServerReadSSRAssets(bundle: Rollup.OutputBundle): Set<string> {
  const assets = new Set<string>();
  for (const [fileName, output] of Object.entries(bundle)) {
    if (output.type !== "chunk" || !output.code.includes("import.meta.url")) continue;
    replaceServerFileReferences(bundle, fileName, output.code, (assetFileName) => {
      assets.add(assetFileName);
      return "";
    });
  }
  return assets;
}

/**
 * The SSR assets only server code can reach: every reference to them in the server bundle is a
 * server file reference. Server code reads these files beside its own chunks, so they must not be
 * copied to the public output.
 *
 * Every other SSR asset stays public. Rendered pages point the browser at an asset through its
 * public URL (`?url` and image imports, metadata images) or through a stylesheet `url()`; an
 * asset that is also referenced that way is browser-reachable by design.
 */
export function collectServerOnlySSRAssets(bundle: Rollup.OutputBundle): Set<string> {
  const serverOnly = new Set<string>();
  const publicReferenceSources: string[] = [];

  for (const [fileName, output] of Object.entries(bundle)) {
    if (output.type !== "chunk") continue;
    if (!output.code.includes("import.meta.url")) {
      publicReferenceSources.push(output.code);
      continue;
    }
    // Drop the server file references themselves so only other references remain to be checked.
    publicReferenceSources.push(
      replaceServerFileReferences(bundle, fileName, output.code, (assetFileName) => {
        serverOnly.add(assetFileName);
        return "";
      }),
    );
  }
  if (serverOnly.size === 0) return serverOnly;

  for (const output of Object.values(bundle)) {
    if (output.type === "asset" && typeof output.source === "string") {
      publicReferenceSources.push(output.source);
    }
  }
  for (const fileName of serverOnly) {
    const name = path.posix.basename(fileName);
    if (publicReferenceSources.some((source) => source.includes(name))) {
      serverOnly.delete(fileName);
    }
  }
  return serverOnly;
}

/**
 * Whether the preset's server can read a file deployed beside its code. Edge runtimes deploy a
 * script, not a directory, and Cloudflare Workers and Vercel Edge also refuse to compile
 * WebAssembly from bytes, which is what Vite's server WebAssembly helper does with the file.
 */
function canReadServerFiles(preset: string): boolean {
  return getFarmPresetRuntime(preset) !== "edge" && !preset.startsWith("cloudflare");
}

/**
 * Fail the build when server code reads an SSR asset from beside the server bundle and the
 * preset's runtime cannot. Otherwise the deployed server would crash when it loads that module.
 */
export function assertServerReadSSRAssetsSupported(
  bundle: Rollup.OutputBundle,
  preset: string,
  root: string,
): void {
  if (canReadServerFiles(preset)) return;
  const assets = [...collectServerReadSSRAssets(bundle)];
  if (assets.length === 0) return;

  const sources = assets.map((fileName) => {
    const output = bundle[fileName];
    const original = output?.type === "asset" ? output.originalFileNames?.[0] : undefined;
    if (!original) return fileName;
    return path.relative(root, path.resolve(root, original)).split(path.sep).join("/");
  });
  throw new Error(
    `The "${preset}" preset cannot run server code that imports ${sources.join(", ")}. ` +
      "Server code reads such a file from beside the server bundle, and this edge runtime " +
      "deploys no such file (Cloudflare Workers and Vercel Edge also refuse to compile " +
      "WebAssembly from bytes). Load it in the browser instead, from client code with the " +
      '@farm.js/wasm plugin or a "?url" import, or deploy to a Node target such as ' +
      "node-server, bun, vercel or netlify.",
  );
}

/**
 * A Nitro Rollup plugin that keeps the files server code reads when Nitro rebundles Farm's SSR
 * output. The bundler emits each file a server file reference names into the server output and
 * renders the reference relative to whichever chunk the code lands in, so it is deployed with
 * the server code (`server/`, a Vercel or Netlify function).
 *
 * Returns `null` when no SSR chunk reads a file.
 */
export function createServerReadSSRAssetsPlugin(
  bundle: Rollup.OutputBundle,
  ssrOutputDir: string,
): Rollup.Plugin | null {
  if (collectServerReadSSRAssets(bundle).size === 0) return null;
  // The prerender build and the final build each emit the files once.
  let referenceIds = new Map<string, string>();

  return {
    name: "farm-server-read-ssr-assets",
    buildStart() {
      referenceIds = new Map();
    },
    transform(code, id) {
      if (!code.includes("import.meta.url")) return null;
      const chunkFileName = path
        .relative(ssrOutputDir, id.split("?", 1)[0])
        .split(path.sep)
        .join("/");
      if (bundle[chunkFileName]?.type !== "chunk") return null;

      let changed = false;
      const transformed = replaceServerFileReferences(
        bundle,
        chunkFileName,
        code,
        (assetFileName) => {
          let referenceId = referenceIds.get(assetFileName);
          if (!referenceId) {
            referenceId = this.emitFile({
              type: "asset",
              fileName: assetFileName,
              source: (bundle[assetFileName] as Rollup.OutputAsset).source,
            });
            referenceIds.set(assetFileName, referenceId);
          }
          changed = true;
          return `new URL(import.meta.ROLLUP_FILE_URL_${referenceId})`;
        },
      );
      return changed ? { code: transformed, map: null } : null;
    },
  };
}
