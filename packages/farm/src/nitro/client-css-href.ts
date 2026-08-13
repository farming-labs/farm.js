import path from "path";

/**
 * Stand-ins for the client asset URLs inside generated server code.
 * The client and SSR graphs build in parallel, so the final asset bytes
 * (fonts are merged into the stylesheet after Vite emits it) do not exist
 * yet when server code is generated. buildNitroUniversal substitutes the
 * real, content-hashed URLs once the client build has settled.
 */
export const FARM_CLIENT_CSS_HREF_PLACEHOLDER = "/__farm_client_css_href__";
export const FARM_CLIENT_JS_SRC_PLACEHOLDER = "/__farm_client_js_src__";

async function hashAndCopy(
  sourcePath: string,
  destinationDir: string,
  hashedName: (hash: string) => string,
): Promise<string | null> {
  const fs = await import("fs/promises");
  try {
    const bytes = await fs.readFile(sourcePath);
    if (bytes.length === 0) return null;
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    const name = hashedName(hash);
    await fs.mkdir(destinationDir, { recursive: true });
    await fs.writeFile(path.join(destinationDir, name), bytes);
    return name;
  } catch {
    return null;
  }
}

/**
 * Content-hash the final client stylesheet and return the href generated
 * server code should reference.
 *
 * The hash is taken after font CSS has been merged in, so any change to the
 * bytes a browser would receive changes the URL. The hashed copy lives under
 * assets/, where the -h fingerprint already qualifies for immutable caching;
 * the stable farm-client.css stays in place for anything that hardcoded it.
 * A missing or empty stylesheet falls back to the stable name, matching the
 * empty file written for intentionally style-free applications.
 */
export async function resolveHashedClientCssHref(clientOutputDir: string): Promise<string> {
  const name = await hashAndCopy(
    path.join(clientOutputDir, "farm-client.css"),
    path.join(clientOutputDir, "assets"),
    (hash) => `farm-client-h${hash}.css`,
  );
  return name ? `/assets/${name}` : "/farm-client.css";
}

/**
 * Content-hash the client entry module and return the src generated server
 * code should reference.
 *
 * Unlike the stylesheet, the hashed copy must stay at the root of the public
 * directory: the entry loads its code-split chunks with relative dynamic
 * imports and resolves assets against import.meta.url, so moving it a level
 * deeper would break every chunk load. The stable farm-client.js remains for
 * anything that hardcoded it.
 */
export async function resolveHashedClientJsSrc(clientOutputDir: string): Promise<string> {
  const name = await hashAndCopy(
    path.join(clientOutputDir, "farm-client.js"),
    clientOutputDir,
    (hash) => `farm-client-h${hash}.js`,
  );
  return name ? `/${name}` : "/farm-client.js";
}
