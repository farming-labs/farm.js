import path from "path";
import type { Rollup } from "vite";

/**
 * A server file reference: `new URL("<relative path>", import.meta.url)`. Vite renders an asset
 * this way for a server consumer when server code reads the emitted file from its own output
 * directory instead of linking to it (its SSR WebAssembly helper reads the bytes with `readFile`).
 * Quotes vary once a later pass reprints the code.
 */
export const SERVER_FILE_URL_RE =
  /new\s+URL\(\s*(["'`])([^"'`\\]+)\1\s*,\s*import\.meta\.url\s*\)/g;

/**
 * The output file a relative server file URL names, resolved from the file that contains it, or
 * `null` when it is root-relative, uses another scheme, or leaves the output directory.
 */
export function resolveBundleFileName(chunkFileName: string, relativeUrl: string): string | null {
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

interface ServerFileReferenceScan {
  /** Assets the server bundle reaches through a server file reference. */
  serverFileAssets: Set<string>;
  /** Bundle sources with those references removed, to look for any other reference. */
  otherReferenceSources: string[];
}

function scanServerFileReferences(bundle: Rollup.OutputBundle): ServerFileReferenceScan {
  const serverFileAssets = new Set<string>();
  const otherReferenceSources: string[] = [];

  for (const [fileName, output] of Object.entries(bundle)) {
    if (output.type !== "chunk") continue;
    if (!output.code.includes("import.meta.url")) {
      otherReferenceSources.push(output.code);
      continue;
    }
    // Drop the server file references themselves so only other references remain to be checked.
    otherReferenceSources.push(
      output.code.replace(SERVER_FILE_URL_RE, (reference, _quote: string, relativeUrl: string) => {
        const target = resolveBundleFileName(fileName, relativeUrl);
        if (!target || bundle[target]?.type !== "asset") return reference;
        serverFileAssets.add(target);
        return "";
      }),
    );
  }
  return { serverFileAssets, otherReferenceSources };
}

/**
 * Every SSR asset server code reads from beside its own chunk through a server file reference,
 * whether or not a page also links to it. The deployed server needs each one next to the code
 * that reads it.
 */
export function collectServerFileSSRAssets(bundle: Rollup.OutputBundle): Set<string> {
  return scanServerFileReferences(bundle).serverFileAssets;
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
  const { serverFileAssets: serverOnly, otherReferenceSources: publicReferenceSources } =
    scanServerFileReferences(bundle);
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
