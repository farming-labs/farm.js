/**
 * The mobile client of an RSC app with a `mobile` block (RFC 0004, 7.2), the RSC pipeline's
 * counterpart of core's `nitro/mobile-client.ts`.
 *
 * The build adds one client entry, `farm-mobile-client`: it hands in-app navigations to the native
 * shell and then runs the browser entry, so it shares every chunk with the web client. The server
 * points the documents a shell asks for (`X-Farm-Shell`) at it, with core's
 * `_applyFarmMobileShellClient`. `.farm/mobile-client.json` records it in core's format, which
 * `farm build --mobile` reads to bundle the client's files into the app.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";

/** The client build's input name, and so the entry file's name: `assets/farm-mobile-client-<hash>.js`. */
export const FARM_RSC_MOBILE_CLIENT_ENTRY_NAME = "farm-mobile-client";

/** The server entry's stand-in for the shell client, replaced once the client is built. */
export const FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER = "__farm_mobile_shell_client__";
/** The client CSS by href, embedded so the RSC server can draw native-tier screens (RFC 0004). */
export const FARM_RSC_NATIVE_STYLESHEETS_PLACEHOLDER = "__farm_native_stylesheets__";

/** Next to the RSC entries, as core writes it to its build directory (`.farm/`); never served. */
const MANIFEST_FILE = "mobile-client.json";

/** What the server needs to point a document at the mobile client (core's `FarmMobileShellClient`). */
export interface FarmRscMobileShellClient {
  webEntry: string;
  entry: string;
  webOnly: string[];
}

/** Core's `FarmMobileClientManifest`, with the directory its files are in. */
export interface FarmRscMobileClientManifest {
  version: 1;
  webEntry: string;
  entry: string;
  stylesheet: string;
  files: string[];
  /** The client output, relative to the app root: the RSC pipeline builds outside `.farm/client`. */
  clientDir: string;
}

/** What the client build records before the Nitro build finishes the manifest. */
interface FarmRscMobileClientBuildRecord {
  entry: string;
  files: string[];
}

/** Vite names every client output file `name-<hash>.ext`, the hash taken from its content. */
const HASHED_FILE = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

export function farmRscMobileClientManifestPath(root: string): string {
  return path.join(root, ".farm", MANIFEST_FILE);
}

/** A build without the mobile entry removes the record an earlier build left. */
export function removeFarmRscMobileClientManifest(root: string): void {
  rmSync(farmRscMobileClientManifestPath(root), { force: true });
}

/**
 * Inside the native shell, whose bridge script runs before the page, hand in-app navigations to
 * the shell's navigator, as core's `farmMobileShellClient` does; in a browser it does nothing. It
 * is written into the entry module rather than imported from a core module the browser entry also
 * imports: the bundler places a shared module's code in the web client's chunks.
 */
export function generateMobileShellNavigation(): string {
  return `import { delegateNavigation as farmDelegateNavigation } from '@farm.js/core/client';
const farmMobileShellBridge = globalThis.__farmBridge;
const farmOfferNavigation = farmMobileShellBridge?.offerNavigation;
if (typeof farmOfferNavigation === 'function') {
  farmDelegateNavigation((context) => farmOfferNavigation.call(farmMobileShellBridge, context) === true);
}
// RSC pages install no SPA router, which is what tells the shell a web screen is ready (its
// first screen, a warm pool WebView), so say so once the document has loaded.
const farmMobileShellReady = farmMobileShellBridge?.ready;
if (typeof farmMobileShellReady === 'function') {
  const farmSignalReady = () => farmMobileShellReady.call(farmMobileShellBridge);
  if (document.readyState === 'complete') queueMicrotask(farmSignalReady);
  else addEventListener('load', farmSignalReady, { once: true });
}
`;
}

/** The mobile entry's source: install the shell's navigation delegate, then run the browser entry. */
export function generateMobileClientEntry(browserEntry: string): string {
  // The browser entry hydrates asynchronously, so the delegate is in place before any click.
  return `import ${JSON.stringify(browserEntry)};
${generateMobileShellNavigation()}`;
}

/** Client build plugin: records the mobile entry and every file the client build wrote. */
export function createFarmRscMobileClientManifestPlugin(getRoot: () => string | undefined) {
  return {
    name: "@farm.js/plugin/rsc:mobile-client-manifest",
    enforce: "post" as const,
    apply: "build" as const,
    generateBundle(
      this: { environment?: { name?: string } },
      _output: unknown,
      bundle: Record<string, { type: string; name?: string; isEntry?: boolean }>,
    ) {
      const root = getRoot();
      if (!root || this.environment?.name !== "client") return;
      const entry = Object.entries(bundle).find(
        ([, output]) =>
          output.type === "chunk" &&
          output.isEntry &&
          output.name === FARM_RSC_MOBILE_CLIENT_ENTRY_NAME,
      )?.[0];
      const record: FarmRscMobileClientBuildRecord | null = entry
        ? {
            entry,
            files: Object.keys(bundle)
              .filter((file) => !file.endsWith(".map"))
              .sort(),
          }
        : null;
      const manifestPath = farmRscMobileClientManifestPath(root);
      mkdirSync(path.dirname(manifestPath), { recursive: true });
      writeFileSync(manifestPath, JSON.stringify(record));
    },
  };
}

function readRecord(root: string): FarmRscMobileClientBuildRecord | null {
  try {
    const record = JSON.parse(readFileSync(farmRscMobileClientManifestPath(root), "utf8"));
    return record && typeof record.entry === "string" && Array.isArray(record.files)
      ? record
      : null;
  } catch {
    return null;
  }
}

/**
 * Finish `.farm/mobile-client.json` once the web entry and the stylesheet are known, and return
 * what the server needs. Null when the build recorded no mobile entry, or its file is missing.
 */
export function finalizeFarmRscMobileClient(options: {
  root: string;
  clientDir: string;
  /** The web entry the bootstrap script imports, such as `/assets/index-<hash>.js`. */
  webEntry: string;
  /** The stylesheet documents link, or "". */
  stylesheet: string;
}): FarmRscMobileShellClient | null {
  const record = readRecord(options.root);
  if (!record || !options.webEntry) return null;
  const entryFile = path.join(options.clientDir, record.entry);
  if (!existsSync(entryFile) || statSync(entryFile).size === 0) return null;
  const files = new Set(
    record.files.filter((file) => HASHED_FILE.test(file)).map((file) => `/${file}`),
  );
  const manifest: FarmRscMobileClientManifest = {
    version: 1,
    webEntry: options.webEntry,
    entry: `/${record.entry}`,
    stylesheet: options.stylesheet,
    files: [...files].sort(),
    clientDir: path.relative(options.root, options.clientDir).split(path.sep).join("/"),
  };
  writeFileSync(
    farmRscMobileClientManifestPath(options.root),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  // The mobile entry loads the web entry, so every web chunk is the mobile client's too.
  return { webEntry: options.webEntry, entry: manifest.entry, webOnly: [] };
}

/** The shell client as the contents of a JavaScript string literal of any quote. */
export function encodeFarmRscMobileShellClient(client: FarmRscMobileShellClient | null): string {
  return JSON.stringify(JSON.stringify(client))
    .slice(1, -1)
    .replace(/'/g, "\\u0027")
    .replace(/`/g, "\\u0060")
    .replace(/\$/g, "\\u0024")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function serverBundleFiles(rscDir: string, placeholder: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) visit(file);
      else if (/\.(?:m|c)?js$/.test(name) && readFileSync(file, "utf8").includes(placeholder)) {
        files.push(file);
      }
    }
  };
  visit(rscDir);
  return files;
}

/**
 * Embed the client CSS, by href, wherever the RSC server bundle has the native-stylesheets
 * placeholder (only a build with the mobile entry): a native-tier screen is drawn with the page's
 * own stylesheets, and the server cannot fetch the static files Nitro serves around it.
 */
export function patchFarmRscNativeStylesheets(rscDir: string, publicDir: string): void {
  const files = serverBundleFiles(rscDir, FARM_RSC_NATIVE_STYLESHEETS_PLACEHOLDER);
  if (files.length === 0) return;
  const stylesheets: Record<string, string> = {};
  const visit = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) visit(file, `${prefix}${name}/`);
      else if (name.endsWith(".css")) stylesheets[`/${prefix}${name}`] = readFileSync(file, "utf8");
    }
  };
  visit(publicDir, "");
  const encoded = JSON.stringify(JSON.stringify(stylesheets))
    .slice(1, -1)
    .replace(/'/g, "\\u0027")
    .replace(/`/g, "\\u0060")
    .replace(/\$/g, "\\u0024")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  for (const file of files) {
    const code = readFileSync(file, "utf8");
    writeFileSync(file, code.split(FARM_RSC_NATIVE_STYLESHEETS_PLACEHOLDER).join(encoded));
  }
}

/**
 * Fill in the shell client wherever the RSC server bundle has the placeholder, which only a build
 * with the mobile entry has. `resolve` runs only then, once: a patched bundle has none left.
 */
export function patchFarmRscMobileShellClient(
  rscDir: string,
  resolve: () => FarmRscMobileShellClient | null,
): void {
  const files: string[] = [];
  const visit = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) visit(file);
      else if (
        /\.(?:m|c)?js$/.test(name) &&
        readFileSync(file, "utf8").includes(FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER)
      ) {
        files.push(file);
      }
    }
  };
  visit(rscDir);
  if (files.length === 0) return;
  const encoded = encodeFarmRscMobileShellClient(resolve());
  for (const file of files) {
    const code = readFileSync(file, "utf8");
    writeFileSync(file, code.split(FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER).join(encoded));
  }
}
