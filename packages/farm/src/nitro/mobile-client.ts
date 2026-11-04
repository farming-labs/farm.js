import fs from "node:fs/promises";
import path from "node:path";
import type { FarmMobileShellClient } from "../mobile/shell-response";

/**
 * The mobile client a web build adds for an app with a `mobile` block (RFC 0004, 7.2). It is the
 * web client's entry and graph built again with `platform()` as `"mobile"` and the shell's
 * navigation delegate, written into the same client output. A document a shell asks for loads it
 * instead of the web client (see `mobile/shell-response.ts`), and `farm build --mobile` bundles
 * its files into the app.
 */
export const FARM_MOBILE_CLIENT_ENTRY_NAME = "farm-mobile-client";

/** Written to the build directory (`.farm/`), next to the client output, never served. */
export const FARM_MOBILE_CLIENT_MANIFEST_FILE = "mobile-client.json";

/** `.farm/mobile-client.json` once the build has finished. */
export interface FarmMobileClientManifest {
  version: 1;
  /** The web client entry documents reference, such as `/farm-client-h1a2b3c4d.js`. */
  webEntry: string;
  /** The mobile client entry a shell's documents load instead. */
  entry: string;
  /** The stylesheet both clients use. */
  stylesheet: string;
  /**
   * Every content-hashed file a shell's document loads, as URL paths: the mobile client's
   * chunks and assets, the stylesheet, and the files the stylesheet references. A shell may
   * answer exactly these paths from its bundle; a hashed name only ever has these bytes.
   */
  files: string[];
  /**
   * The client output the files are in, relative to the app root, when it is not the build
   * directory's `client/`: the RSC pipeline (`@farm.js/plugin/rsc`) writes this manifest too.
   */
  clientDir?: string;
}

/** What the client build records before the server build finishes the manifest. */
interface FarmMobileClientBuildRecord {
  entry: string;
  files: string[];
}

/** A content-hashed file name, as Farm's client builds emit them: `name-h<hex>.ext`. */
const HASHED_FILE = /-h[0-9a-f]{8,}\.[A-Za-z0-9]+$/;

export function isFarmContentHashedFile(file: string): boolean {
  return HASHED_FILE.test(file);
}

function manifestPath(buildDir: string): string {
  return path.join(buildDir, FARM_MOBILE_CLIENT_MANIFEST_FILE);
}

/** A build without a mobile client removes the record an earlier build left. */
export async function removeFarmMobileClientManifest(buildDir: string): Promise<void> {
  await fs.rm(manifestPath(buildDir), { force: true });
}

/** Client build plugin: records the mobile entry and every file the mobile build wrote. */
export function createFarmMobileClientManifestPlugin(options: {
  buildDir: string;
  entryName: string;
}) {
  return {
    name: "farm-mobile-client-manifest",
    enforce: "post" as const,
    async generateBundle(
      _output: unknown,
      bundle: Record<string, { type: string; name?: string; isEntry?: boolean }>,
    ) {
      const entry = Object.entries(bundle).find(
        ([, output]) =>
          output.type === "chunk" && output.isEntry && output.name === options.entryName,
      )?.[0];
      const record: FarmMobileClientBuildRecord | null = entry
        ? {
            entry,
            files: Object.keys(bundle)
              .filter((file) => !file.endsWith(".css") && !file.endsWith(".map"))
              .sort(),
          }
        : null;
      await fs.mkdir(options.buildDir, { recursive: true });
      await fs.writeFile(manifestPath(options.buildDir), JSON.stringify(record));
    },
  };
}

/** Whether the mobile build wrote a non-empty entry; Rolldown's rare incomplete build does not. */
export async function hasFarmMobileClientEntry(
  buildDir: string,
  clientOutputDir: string,
): Promise<boolean> {
  let record: FarmMobileClientBuildRecord | null = null;
  try {
    record = JSON.parse(await fs.readFile(manifestPath(buildDir), "utf8"));
  } catch {
    return false;
  }
  if (!record) return false;
  return fs.stat(path.join(clientOutputDir, record.entry)).then(
    (stat) => stat.isFile() && stat.size > 0,
    () => false,
  );
}

/** Absolute `url(/...)` references in a stylesheet. */
function stylesheetUrls(css: string): string[] {
  const urls: string[] = [];
  for (const match of css.matchAll(/url\(\s*(["']?)(\/[^"')?#]+)[^"')]*\1\s*\)/g)) {
    urls.push(match[2]!);
  }
  return urls;
}

/**
 * Finish `.farm/mobile-client.json` once the stylesheet and the web entry have their final
 * hashed names, and return what the server needs to answer a shell's documents. Null when the
 * build recorded no mobile client.
 */
export async function finalizeFarmMobileClient(options: {
  buildDir: string;
  clientOutputDir: string;
  /** `/farm-client-h<hash>.js`, as documents reference it. */
  webEntry: string;
  /** The hashed stylesheet href, such as `/assets/farm-client-h<hash>.css`. */
  stylesheet: string;
  /** The web client's chunk files (from its preload manifest), without leading slashes. */
  webFiles: readonly string[];
}): Promise<FarmMobileShellClient | null> {
  let record: FarmMobileClientBuildRecord | null = null;
  try {
    record = JSON.parse(await fs.readFile(manifestPath(options.buildDir), "utf8"));
  } catch {
    return null;
  }
  if (!record) return null;
  const mobileFiles = new Set(record.files);
  const files = new Set(record.files.filter(isFarmContentHashedFile).map((file) => `/${file}`));
  const stylesheetFile = options.stylesheet.replace(/^\/+/, "");
  if (isFarmContentHashedFile(stylesheetFile)) {
    files.add(`/${stylesheetFile}`);
    const css = await fs
      .readFile(path.join(options.clientOutputDir, stylesheetFile), "utf8")
      .catch(() => "");
    for (const url of stylesheetUrls(css)) {
      const file = url.replace(/^\/+/, "");
      if (!isFarmContentHashedFile(file)) continue;
      const exists = await fs.stat(path.join(options.clientOutputDir, file)).then(
        (stat) => stat.isFile(),
        () => false,
      );
      if (exists) files.add(`/${file}`);
    }
  }
  const manifest: FarmMobileClientManifest = {
    version: 1,
    webEntry: options.webEntry,
    entry: `/${record.entry}`,
    stylesheet: options.stylesheet,
    files: [...files].sort(),
  };
  await fs.writeFile(manifestPath(options.buildDir), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    webEntry: options.webEntry,
    entry: manifest.entry,
    webOnly: options.webFiles.filter((file) => !mobileFiles.has(file)).sort(),
  };
}

/** Read the finished manifest, or null when the last build had no mobile client. */
export async function readFarmMobileClientManifest(
  buildDir: string,
): Promise<FarmMobileClientManifest | null> {
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath(buildDir), "utf8"));
    return manifest && manifest.version === 1 ? (manifest as FarmMobileClientManifest) : null;
  } catch {
    return null;
  }
}

/** The server's shell client as the contents of a JavaScript string literal of any quote. */
export function encodeFarmMobileShellClient(client: FarmMobileShellClient | null): string {
  return JSON.stringify(JSON.stringify(client))
    .slice(1, -1)
    .replace(/'/g, "\\u0027")
    .replace(/`/g, "\\u0060")
    .replace(/\$/g, "\\u0024")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Replaced in the server bundle once the mobile client is final. */
export const FARM_MOBILE_SHELL_CLIENT_PLACEHOLDER = "__farm_mobile_shell_client__";
