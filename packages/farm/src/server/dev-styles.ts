import * as fs from "node:fs";
import * as path from "node:path";
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

/**
 * The URL of the app's `<srcDir>/app/globals.css`, or undefined when the app has
 * none. Dev links it only when it exists, as the production build imports it
 * only when it exists; an app without one gets no link rather than a 500.
 */
export function resolveDevGlobalStylesheetHref(root: string, srcDir = "src"): string | undefined {
  const file = path.join(root, srcDir, "app", "globals.css");
  if (!fs.existsSync(file)) return undefined;
  return `/${path.relative(root, file).split(path.sep).join("/")}`;
}

const STYLE_EXTENSIONS = /\.(css|scss|sass|less|styl|stylus)(?:$|\?)/;

/** The stylesheet link the shell already emits by default; its own `@import`s
 * resolve inside that response, so neither it nor its query variants repeat here. */
const ALREADY_LINKED = "/src/app/globals.css";

/**
 * Stylesheet URLs from the module graph that the document should link,
 * deduped and sorted for a deterministic head. CSS modules (`.module.css`)
 * are left out: their stylesheet comes with the client module that imports
 * them. In islands mode a server component's CSS module has no client module,
 * so `cssModules` links it as `?direct`, which Vite answers with the compiled
 * stylesheet, hashed classes included.
 */
export function collectDevStylesheetUrls(
  modules: Iterable<DevStyleModule>,
  alreadyLinked: string = ALREADY_LINKED,
  options: { cssModules?: boolean } = {},
): string[] {
  const seen = new Set<string>();
  for (const mod of modules) {
    const id = mod.id ?? mod.file ?? "";
    if (!STYLE_EXTENSIONS.test(id)) continue;
    const cssModule = id.includes(".module.");
    if (cssModule && !options.cssModules) continue;
    const url = mod.url;
    if (!url || !url.startsWith("/")) continue;
    const bare = url.split("?")[0]!;
    if (bare === alreadyLinked) continue;
    seen.add(cssModule ? `${bare}?direct` : bare);
  }
  return [...seen].sort();
}
