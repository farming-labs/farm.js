const STYLEX_DEVELOPMENT_CSS = "/virtual:stylex.css";
const STYLEX_DEVELOPMENT_RUNTIME = "/@id/virtual:stylex:runtime";

/** Add StyleX's development CSS before paint and connect its HMR runtime. */
export function injectStylexDevelopmentAssets(html: string): string {
  const closingHead = html.search(/<\/head\s*>/i);
  if (closingHead < 0) return html;
  const head = html.slice(0, closingHead);

  const tags: string[] = [];
  if (!hasStylexAsset(head, "link", "css")) {
    tags.push(`<link rel="stylesheet" href="${STYLEX_DEVELOPMENT_CSS}" data-farm-stylex="css">`);
  }
  if (!hasStylexAsset(head, "script", "runtime")) {
    tags.push(
      `<script type="module" src="${STYLEX_DEVELOPMENT_RUNTIME}" data-farm-stylex="runtime"></script>`,
    );
  }
  if (tags.length === 0) return html;

  return `${html.slice(0, closingHead)}${tags.join("")}${html.slice(closingHead)}`;
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
