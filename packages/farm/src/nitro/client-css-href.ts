import path from "path";

/**
 * Stands in for the client stylesheet href inside generated server code.
 * The client and SSR graphs build in parallel, so the final stylesheet bytes
 * (fonts are merged in after Vite emits them) do not exist yet when server
 * code is generated. buildNitroUniversal substitutes the real, content-hashed
 * href when it writes the SSR bundle to disk.
 */
export const FARM_CLIENT_CSS_HREF_PLACEHOLDER = "/__farm_client_css_href__";

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
  const fs = await import("fs/promises");
  try {
    const css = await fs.readFile(path.join(clientOutputDir, "farm-client.css"));
    if (css.length > 0) {
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(css).digest("hex").slice(0, 8);
      const hashedName = `farm-client-h${hash}.css`;
      const assetsDir = path.join(clientOutputDir, "assets");
      await fs.mkdir(assetsDir, { recursive: true });
      await fs.writeFile(path.join(assetsDir, hashedName), css);
      return `/assets/${hashedName}`;
    }
  } catch {
    // Fall through to the stable name.
  }
  return "/farm-client.css";
}
