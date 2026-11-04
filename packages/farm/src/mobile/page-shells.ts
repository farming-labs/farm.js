/**
 * Page shells (`mobile.shells`, RFC 0004 7.2): what `farm build --mobile` bundles so a web screen
 * shows the route's layout and loading state before the server answers, and while it cannot be
 * reached. The build asks its own server for each route (see `shell-render.ts`), keeps the
 * document's markup and styles, drops every script, and names each shell by its content hash, so
 * routes with the same shell share one file. Loaded only by mobile commands.
 */
import { createHash } from "node:crypto";

import type { FarmMobileOS } from "./config";
import type { FarmMobileShellManifest } from "./routes";
import {
  FARM_SHELL_RENDER_HEADER,
  FARM_SHELL_ROUTE_HEADER,
  createFarmMobileShellRenderPath,
} from "./shell-render";
import { FARM_SHELL_HEADER } from "./shell-response";

export {
  FARM_SHELL_PARAM_SEGMENT,
  FARM_SHELL_RENDER_HEADER,
  FARM_SHELL_ROUTE_HEADER,
  createFarmMobileShellRenderPath,
} from "./shell-render";

/** The page shells of one build, as a shell package writes them into the app. */
export interface FarmMobilePageShells extends FarmMobileShellManifest {
  /** Shell HTML by file name, such as `{ "1a2b3c4d5e6f7a8b.html": "<!DOCTYPE html>..." }`. */
  files: Record<string, string>;
}

export interface FarmMobilePageShellOptions {
  os: FarmMobileOS;
  /**
   * The text of a stylesheet the document links, by its href, such as `/assets/app-h1a2.css`;
   * undefined for one the build did not write. iOS shells inline every stylesheet they can
   * (`loadHTMLString` has no bundled files to load it from); Android loads it from the app.
   */
  readStylesheet?: (href: string) => string | undefined;
}

const SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const LINK = /<link\b[^>]*>/gi;
// Stands in for a removed element until the lines left with nothing else are removed too, so
// documents that differ only in what a shell drops (a client page's preloads) give one shell.
const REMOVED = "\u0000";
// eslint-disable-next-line no-control-regex -- NUL is the removed-element sentinel above.
const REMOVED_ALL = /\u0000/g;
// eslint-disable-next-line no-control-regex -- NUL is the removed-element sentinel above.
const REMOVED_LINE = /\n[ \t\u0000]*\u0000[ \t\u0000]*(?=\n|$)/g;
const HEAD = /<head\b[^>]*>[\s\S]*?<\/head\s*>/i;
const BLANK_LINE = /\n[ \t]*(?=\n)/g;

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"),
  );
  if (!match) return undefined;
  return (match[1] ?? match[2] ?? match[3] ?? "").replace(/&amp;/g, "&");
}

function relList(tag: string): string[] {
  return (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

/** `</style` cannot end the inlined stylesheet early: `\/` is the same character in CSS. */
function inlineStyle(css: string, media: string | undefined): string {
  const safeMedia = media && /^[\w\s(),:.-]+$/.test(media) ? ` media="${media}"` : "";
  return `<style${safeMedia}>${css.replace(/<\/(style)/gi, "<\\/$1")}</style>`;
}

/**
 * A rendered document as a page shell: every script and script preload removed (a shell never
 * runs code; the real document does), the links that name the request's URL (`canonical`,
 * `alternate`: locale and markdown versions) removed, so a shell is the same file for every route
 * that shares it and carries no address of the build's server, `data-farm-page-shell` on `<html>`
 * so app CSS can tell, and on iOS each stylesheet the build wrote inlined.
 */
export function createFarmMobilePageShell(
  html: string,
  options: FarmMobilePageShellOptions,
): string {
  // A NUL is never markup a shell needs (the HTML parser drops or replaces it).
  let shell = html.replace(REMOVED_ALL, "").replace(SCRIPT, REMOVED);
  shell = shell.replace(LINK, (tag) => {
    const rel = relList(tag);
    if (
      rel.includes("modulepreload") ||
      (rel.includes("preload") && (attribute(tag, "as") ?? "").toLowerCase() === "script") ||
      (!rel.includes("stylesheet") && (rel.includes("canonical") || rel.includes("alternate")))
    ) {
      return REMOVED;
    }
    if (options.os !== "ios" || !rel.includes("stylesheet")) return tag;
    const href = attribute(tag, "href");
    const css = href === undefined ? undefined : options.readStylesheet?.(href);
    return css === undefined ? tag : inlineStyle(css, attribute(tag, "media"));
  });
  shell = shell.replace(REMOVED_LINE, "").replace(REMOVED_ALL, "");
  // The document template leaves empty lines in <head> where a client page has its client data;
  // head whitespace never renders, so a server page and a client page get the same shell.
  shell = shell.replace(HEAD, (head) => head.replace(BLANK_LINE, ""));
  return shell.replace(/<html\b([^>]*)>/i, (tag, attributes: string) =>
    /\sdata-farm-page-shell\b/i.test(attributes) ? tag : `<html${attributes} data-farm-page-shell>`,
  );
}

/** A shell's file name: its content hash, so equal shells share one file. */
export function getFarmMobilePageShellFile(shell: string): string {
  return `${createHash("sha256").update(shell).digest("hex").slice(0, 16)}.html`;
}

export interface RenderFarmMobilePageShellsOptions extends FarmMobilePageShellOptions {
  /** Page route patterns, route groups removed. */
  routes: readonly string[];
  /** The token the build's server answers shell requests with. */
  token: string;
  /** The app's basePath ("" or "/base"). */
  basePath: string;
  /** The mobile client entry of the build, from `mobile-client.json`. */
  client: string;
  /** Requests a path (with the base path) from the build's server. */
  fetch: (path: string, init: { headers: Record<string, string> }) => Promise<Response>;
  /** Requests in flight at once; defaults to 4. */
  concurrency?: number;
}

export interface RenderedFarmMobilePageShells {
  shells: FarmMobilePageShells;
  /** Routes without a shell and why, for `--verbose` output. */
  skipped: { route: string; reason: string }[];
}

/**
 * Ask the build's server for each route's shell and keep the ones it renders. The server decides
 * which routes qualify (a loading file and layouts in static folders) and says why the others do
 * not; middleware and guards run as for any request, so a route they redirect gets no shell.
 */
export async function renderFarmMobilePageShells(
  options: RenderFarmMobilePageShellsOptions,
): Promise<RenderedFarmMobilePageShells> {
  const routes: Record<string, string> = {};
  const files: Record<string, string> = {};
  const skipped: { route: string; reason: string }[] = [];
  const queue = [...new Set(options.routes)].sort();
  const render = async (route: string) => {
    const response = await options.fetch(
      `${options.basePath}${createFarmMobileShellRenderPath(route)}`,
      {
        headers: {
          Accept: "text/html",
          [FARM_SHELL_HEADER]: options.os,
          [FARM_SHELL_RENDER_HEADER]: options.token,
          [FARM_SHELL_ROUTE_HEADER]: route,
        },
      },
    );
    const body = await response.text();
    if (response.headers.get(FARM_SHELL_RENDER_HEADER) === "none") {
      skipped.push({ route, reason: body.trim() || "the server rendered no shell" });
      return;
    }
    const type = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (response.status !== 200 || !type.includes("text/html")) {
      const location = response.headers.get("location");
      skipped.push({
        route,
        reason: `the server answered ${response.status}${location ? ` (to ${location})` : ""}`,
      });
      return;
    }
    const shell = createFarmMobilePageShell(body, options);
    const file = getFarmMobilePageShellFile(shell);
    files[file] = shell;
    routes[route] = file;
  };
  const workers = Array.from(
    { length: Math.max(1, Math.min(options.concurrency ?? 4, queue.length)) },
    async () => {
      for (let route = queue.shift(); route !== undefined; route = queue.shift()) {
        await render(route);
      }
    },
  );
  await Promise.all(workers);
  skipped.sort((left, right) => (left.route < right.route ? -1 : left.route > right.route ? 1 : 0));
  return {
    shells: {
      client: options.client,
      routes: Object.fromEntries(Object.entries(routes).sort(([a], [b]) => (a < b ? -1 : 1))),
      files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))),
    },
    skipped,
  };
}
