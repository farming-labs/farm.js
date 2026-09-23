// Stylesheets the dev document must link beyond globals.css.
//
// The dev shell links `/src/app/globals.css` and nothing else, so CSS that
// enters through a JS import — `import "@fontsource-variable/geist"` in a
// layout, a component stylesheet, vendor CSS — never reaches the page: no
// error, just silently missing rules (farming-labs/farm.js#658). Vite's module
// graph knows every stylesheet the app touched; collecting it closes the gap.

/** The slice of Vite's ModuleNode this module reads, kept minimal for tests. */
export interface DevStyleModule {
  url?: string | null;
  id?: string | null;
  file?: string | null;
}

const STYLE_EXTENSIONS = /\.(css|scss|sass|less|styl|stylus)(?:$|\?)/;

/** The stylesheet link the shell already emits; its own `@import`s resolve
 * inside that response, so neither it nor its query variants repeat here. */
const ALREADY_LINKED = "/src/app/globals.css";

/**
 * Stylesheet URLs from the module graph that the document should link,
 * deduped and sorted for a deterministic head. CSS modules (`.module.css`)
 * are excluded: their classes are hashed through the JS pipeline and a plain
 * link would apply nothing useful.
 */
export function collectDevStylesheetUrls(modules: Iterable<DevStyleModule>): string[] {
  const seen = new Set<string>();
  for (const mod of modules) {
    const id = mod.id ?? mod.file ?? "";
    if (!STYLE_EXTENSIONS.test(id)) continue;
    if (id.includes(".module.")) continue;
    const url = mod.url;
    if (!url || !url.startsWith("/")) continue;
    const bare = url.split("?")[0]!;
    if (bare === ALREADY_LINKED) continue;
    seen.add(bare);
  }
  return [...seen].sort();
}
