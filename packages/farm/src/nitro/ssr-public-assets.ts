import path from "path";
import type { Rollup } from "vite";

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
      output.code.replace(SERVER_FILE_URL_RE, (reference, _quote: string, relativeUrl: string) => {
        const target = resolveBundleFileName(fileName, relativeUrl);
        if (!target || bundle[target]?.type !== "asset") return reference;
        serverOnly.add(target);
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
