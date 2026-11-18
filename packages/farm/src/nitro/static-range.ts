import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Rollup } from "vite";

/**
 * Nitro's public file handler (`nitro/dist/runtime/internal/static.mjs` in the pinned release)
 * with single byte-range requests (RFC 9110 14). The pinned handler answers `Range` with the
 * whole file and no `Accept-Ranges`, so Safari, iOS Messages and other players that probe a
 * video with `Range: bytes=0-1` play nothing from a self-hosted server.
 *
 * The range code follows nitrojs/nitro#5065. Remove this file once Farm's Nitro includes it:
 * the plugin below already steps aside when Nitro's own handler sends `Accept-Ranges`.
 */
export const FARM_NITRO_STATIC_HANDLER_SOURCE = `import { HTTPError, defineHandler } from "h3";
import { decodePath, joinURL, withLeadingSlash, withoutTrailingSlash } from "ufo";
import { getAsset, isPublicAssetURL, readAsset } from "#nitro/virtual/public-assets";
const METHODS = new Set(["HEAD", "GET"]);
const EncodingMap = {
	gzip: ".gz",
	br: ".br",
	zstd: ".zst"
};
const RANGE_RE = /^bytes=(\\d*)-(\\d*)$/i;
export default defineHandler((event) => {
	if (event.req.method && !METHODS.has(event.req.method)) {
		return;
	}
	let id = decodePath(withLeadingSlash(withoutTrailingSlash(event.url.pathname)));
	let asset;
	const encodingHeader = event.req.headers.get("accept-encoding") || "";
	const encodings = [...encodingHeader.split(",").map((e) => EncodingMap[e.trim()]).filter(Boolean).sort(), ""];
	for (const encoding of encodings) {
		for (const _id of [id + encoding, joinURL(id, "index.html" + encoding)]) {
			const _asset = getAsset(_id);
			if (_asset) {
				asset = _asset;
				id = _id;
				break;
			}
		}
	}
	if (!asset) {
		if (isPublicAssetURL(id)) {
			event.res.headers.delete("Cache-Control");
			throw new HTTPError({ status: 404 });
		}
		return;
	}
	if (encodings.length > 1) {
		event.res.headers.append("Vary", "Accept-Encoding");
	}
	const ifNotMatch = event.req.headers.get("if-none-match") === asset.etag;
	if (ifNotMatch) {
		event.res.status = 304;
		event.res.statusText = "Not Modified";
		return "";
	}
	const ifModifiedSinceH = event.req.headers.get("if-modified-since");
	const mtimeDate = new Date(asset.mtime);
	if (ifModifiedSinceH && asset.mtime && new Date(ifModifiedSinceH) >= mtimeDate) {
		event.res.status = 304;
		event.res.statusText = "Not Modified";
		return "";
	}
	if (asset.type) {
		event.res.headers.set("Content-Type", asset.type);
	}
	if (asset.etag && !event.res.headers.has("ETag")) {
		event.res.headers.set("ETag", asset.etag);
	}
	if (asset.mtime && !event.res.headers.has("Last-Modified")) {
		event.res.headers.set("Last-Modified", mtimeDate.toUTCString());
	}
	if (asset.encoding && !event.res.headers.has("Content-Encoding")) {
		event.res.headers.set("Content-Encoding", asset.encoding);
	}
	let range;
	if (!asset.encoding && asset.size > 0) {
		event.res.headers.set("Accept-Ranges", "bytes");
		// If-Range needs a strong validator match (RFC 9110 13.1.5).
		const ifRange = event.req.headers.get("if-range");
		if (event.req.method === "GET" && (!ifRange || (ifRange === asset.etag && !ifRange.startsWith("W/")))) {
			range = parseRange(event.req.headers.get("range") || "", asset.size);
		}
	}
	if (range === "unsatisfiable") {
		event.res.headers.delete("Cache-Control");
		throw new HTTPError({ status: 416, headers: { "Content-Range": \`bytes */\${asset.size}\` } });
	}
	if (asset.size > 0 && !event.res.headers.has("Content-Length")) {
		event.res.headers.set("Content-Length", asset.size.toString());
	}
	if (!range) {
		return readAsset(id);
	}
	return Promise.resolve(readAsset(id)).then((data) => {
		if (!(data instanceof Uint8Array)) {
			return data;
		}
		event.res.status = 206;
		event.res.headers.set("Content-Range", \`bytes \${range.start}-\${range.end}/\${asset.size}\`);
		event.res.headers.set("Content-Length", String(range.end - range.start + 1));
		return data.subarray(range.start, range.end + 1);
	});
});
// One "bytes=" range; anything else (several ranges, other units) gets the whole file.
function parseRange(header, size) {
	const match = RANGE_RE.exec(header);
	if (!match) {
		return;
	}
	const [, startStr, endStr] = match;
	if (!startStr) {
		if (!endStr) {
			return;
		}
		const suffix = Number(endStr);
		if (suffix === 0) {
			return "unsatisfiable";
		}
		return { start: Math.max(size - suffix, 0), end: size - 1 };
	}
	const start = Number(startStr);
	if (endStr && Number(endStr) < start) {
		return;
	}
	if (start >= size) {
		return "unsatisfiable";
	}
	return { start, end: endStr ? Math.min(Number(endStr), size - 1) : size - 1 };
}
`;

/**
 * Serves {@link FARM_NITRO_STATIC_HANDLER_SOURCE} in place of Nitro's static handler, under the
 * same module id, so its `h3`, `ufo` and `#nitro/virtual/*` imports resolve as Nitro's own do.
 * Only presets that serve public files from the server (`serveStatic`) import that handler.
 *
 * With `canonicalPages`, the handler first answers each page's other slash spelling with a 308 to
 * the canonical URL, keeping the query. It compares the exact request pathname, so the canonical
 * URL itself is always served.
 */
export function createNitroStaticRangePlugin(
  nitroPackageEntry: string,
  canonicalPages: readonly string[] = [],
): Rollup.Plugin {
  const redirects = canonicalPages
    .filter((url) => url !== "/" && !url.startsWith("//"))
    .map((url) => [url.endsWith("/") ? url.slice(0, -1) : url + "/", url]);
  const original = "?farm-static-handler";
  const handlerFile = path.join(path.dirname(nitroPackageEntry), "internal", "static.mjs");
  const handlerIds = new Set([toPosix(handlerFile)]);
  try {
    handlerIds.add(toPosix(realpathSync(handlerFile)));
  } catch {
    // Nitro without this file has another static handler; the hook then never matches.
  }
  return {
    name: "farm:nitro-static-range",
    resolveId(id) {
      if (id.endsWith(original) && handlerIds.has(id.slice(0, -original.length))) return id;
      return null;
    },
    load: {
      filter: { id: /[\\/]internal[\\/]static\.mjs(?:\?.*)?$/ },
      handler(id) {
        const file = id.split("?", 1)[0];
        if (!handlerIds.has(toPosix(file))) return null;
        if (redirects.length && !id.endsWith(original)) {
          // Nitro matches route rules without the trailing slash. Match the actual URL before
          // its file handler tries both the directory and its index.
          return `import serve from ${JSON.stringify(toPosix(file) + original)};
const redirects = new Map(${JSON.stringify(redirects)});
export default function(event) {
  const url = new URL(event.req.url);
  const target = redirects.get(url.pathname);
  if (target !== undefined) return new Response(null, { status: 308, headers: { Location: target + url.search } });
  return serve(event);
}`;
        }
        // A Nitro that answers ranges itself keeps its own handler.
        const source = readFileSync(file, "utf8");
        if (source.includes("Accept-Ranges")) return id.endsWith(original) ? source : null;
        return FARM_NITRO_STATIC_HANDLER_SOURCE;
      },
    },
  };
}

function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}
