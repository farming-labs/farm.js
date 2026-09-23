const STYLEX_DEVELOPMENT_CSS = "/virtual:stylex.css";
const STYLEX_DEVELOPMENT_RUNTIME = "/@id/virtual:stylex:runtime";

/** Add StyleX's development CSS before paint and connect its HMR runtime. */
export function injectStylexDevelopmentAssets(html: string, basePath = "/"): string {
  const closingHead = html.search(/<\/head\s*>/i);
  if (closingHead < 0) return html;
  const head = html.slice(0, closingHead);
  const cssUrl = withBasePath(STYLEX_DEVELOPMENT_CSS, basePath);
  const runtimeUrl = withBasePath(STYLEX_DEVELOPMENT_RUNTIME, basePath);

  const tags: string[] = [];
  if (!hasStylexAsset(head, "link", "css")) {
    tags.push(`<link rel="stylesheet" href="${cssUrl}" data-farm-stylex="css">`);
  }
  if (!hasStylexAsset(head, "script", "runtime")) {
    tags.push(`<script type="module" src="${runtimeUrl}" data-farm-stylex="runtime"></script>`);
  }
  if (tags.length === 0) return html;

  return `${html.slice(0, closingHead)}${tags.join("")}${html.slice(closingHead)}`;
}

/** Strip Farm's mount path before StyleX's development middleware resolves its virtual assets. */
export function stripStylexDevelopmentBasePath(url: string, basePath: string): string {
  const prefix = normalizeBasePath(basePath);
  if (!prefix) return url;

  for (const asset of [STYLEX_DEVELOPMENT_CSS, STYLEX_DEVELOPMENT_RUNTIME]) {
    const prefixedAsset = `${prefix}${asset}`;
    if (url === prefixedAsset || url.startsWith(`${prefixedAsset}?`)) {
      return url.slice(prefix.length);
    }
  }
  return url;
}

function hasStylexAsset(html: string, tagName: "link" | "script", value: string): boolean {
  const tags =
    tagName === "link"
      ? html.matchAll(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)
      : html.matchAll(/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi);

  for (const tag of tags) {
    const attributes = tag[0].slice(tagName.length + 1, -1);
    const parsed = attributes.matchAll(
      /([^\s"'<>=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g,
    );
    for (const attribute of parsed) {
      const attributeValue = attribute[2] ?? attribute[3] ?? attribute[4];
      if (attribute[1]?.toLowerCase() === "data-farm-stylex" && attributeValue === value) {
        return true;
      }
    }
  }
  return false;
}

function withBasePath(url: string, basePath: string): string {
  return `${normalizeBasePath(basePath)}${url}`;
}

function normalizeBasePath(basePath: string): string {
  const normalized = basePath.replace(/^\/+|\/+$/g, "");
  return normalized ? `/${normalized}` : "";
}
