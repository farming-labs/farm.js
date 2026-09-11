const STYLEX_DEVELOPMENT_CSS = "/virtual:stylex.css";
const STYLEX_DEVELOPMENT_RUNTIME = "/@id/virtual:stylex:runtime";

/** Add StyleX's development CSS before paint and connect its HMR runtime. */
export function injectStylexDevelopmentAssets(html: string): string {
  const closingHead = html.search(/<\/head\s*>/i);
  if (closingHead < 0) return html;

  const tags: string[] = [];
  if (!html.includes('data-farm-stylex="css"')) {
    tags.push(`<link rel="stylesheet" href="${STYLEX_DEVELOPMENT_CSS}" data-farm-stylex="css">`);
  }
  if (!html.includes('data-farm-stylex="runtime"')) {
    tags.push(
      `<script type="module" src="${STYLEX_DEVELOPMENT_RUNTIME}" data-farm-stylex="runtime"></script>`,
    );
  }
  if (tags.length === 0) return html;

  return `${html.slice(0, closingHead)}${tags.join("")}${html.slice(closingHead)}`;
}
