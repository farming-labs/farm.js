import { existsSync } from "node:fs";
import * as path from "node:path";

import {
  createPlatformBlockChecker,
  isPlainObject,
  readAppPackageJson,
  resolveAppPackageName,
  resolvePlatformBlock,
  resolvePlatformProfile,
  type PlatformBlockCache,
  type PlatformBlockChecker,
} from "../platform-blocks";
import { getRoutePatternShape } from "../routing/specificity";

export type FarmMobileOS = "android" | "ios";

/** How the native navigator shows a route: on a new stack screen, as a sheet, or in place. */
export type FarmMobilePresentation = "push" | "modal" | "replace";

export interface FarmMobileTab {
  /** A static app route, such as `"/notes"`. Its screen is the tab's root. */
  path: string;
  title: string;
  /** Platform icon name: an Android drawable or an SF Symbol on iOS, such as `"note.text"`. */
  icon: string;
}

export interface FarmMobileRouteConfig {
  /** Defaults to `"push"`. */
  presentation?: FarmMobilePresentation;
  /**
   * Show a native screen instead of a WebView: the name of a module in `src/native/`, such as
   * `"feed"` for `src/native/feed.tsx`.
   */
  native?: string;
}

export interface FarmMobileUserConfig {
  /** Display name of the app. Defaults to the package.json `productName` or `name`. */
  name?: string;
  /**
   * Reverse-DNS app identifier, used as the Android application ID and the iOS bundle ID, such as
   * `"com.example.notes"`. Stores key the app on it. Defaults to `local.farm.<name>`.
   */
  id?: string;
  /**
   * Origin of the web deployment whose pages the app shows, such as `"https://notes.example.com"`.
   * `http://` is allowed only for loopback and LAN hosts in dev.
   */
  server?: string;
  /** Tab bar entries, at most 5. Without tabs the app is one stack starting at `/`. */
  tabs?: FarmMobileTab[];
  /** Per-route navigation, keyed by app route pattern such as `"/notes/[id]"`. */
  routes?: Record<string, FarmMobileRouteConfig>;
}

/** What a function-valued `mobile` block receives. Resolved once per OS per dev start or build. */
export interface FarmMobileContext {
  os: FarmMobileOS;
  mode: "development" | "production";
  command: "dev" | "build";
  /** `--profile`, `"production"` by default. */
  profile: string;
  env: Readonly<Record<string, string | undefined>>;
  /** App root. */
  root: string;
}

/**
 * `mobile` in farm.config: a static block, or a function of the platform context that returns
 * one. The function runs in the CLI only; its code never reaches a server or browser bundle.
 */
export type FarmMobileConfigInput =
  | FarmMobileUserConfig
  | ((context: FarmMobileContext) => FarmMobileUserConfig | Promise<FarmMobileUserConfig>);

export interface ResolvedFarmMobileConfig {
  name: string;
  id: string;
  /** Origin, without a trailing slash. Undefined only when the CLI supplies one (dev). */
  server?: string;
  tabs: FarmMobileTab[];
  routes: Record<string, FarmMobileRouteConfig>;
}

const MOBILE_KEYS = new Set(["name", "id", "server", "tabs", "routes"]);
const TAB_KEYS = new Set(["path", "title", "icon"]);
const ROUTE_KEYS = new Set(["presentation", "native"]);
const PRESENTATIONS = new Set(["push", "modal", "replace"]);
const MOBILE_OS = new Set(["android", "ios"]);
const MAX_TABS = 5;
/** Valid as an Android application ID and an iOS bundle ID: letters and digits per segment. */
const APP_ID_SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/;
// Android rejects application ID segments that are Java keywords.
const JAVA_KEYWORDS = new Set(
  (
    "abstract assert boolean break byte case catch char class const continue default do double " +
    "else enum extends false final finally float for goto if implements import instanceof int " +
    "interface long native new null package private protected public return short static " +
    "strictfp super switch synchronized this throw throws transient true try void volatile while"
  ).split(" "),
);
const ICON_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NATIVE_MODULE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const NATIVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

function mobileChecker(context?: Pick<FarmMobileContext, "os">): PlatformBlockChecker {
  return createPlatformBlockChecker(context ? `mobile (os: ${context.os})` : "mobile");
}

function isLoopbackOrLanHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || /^fe[89ab][0-9a-f]:/.test(host) || /^f[cd][0-9a-f]{2}:/.test(host)) {
    return true;
  }
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/**
 * The origin a mobile app loads pages from. `https://` anywhere; `http://` only for loopback and
 * LAN hosts (the emulator's `10.0.2.2`, `192.168.x.y`, `*.local`) when `command` is `"dev"`.
 */
export function resolveFarmMobileServer(
  value: string,
  context: Pick<FarmMobileContext, "command">,
  check: PlatformBlockChecker = mobileChecker(),
  key = "server",
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return check.fail(`${key} must be an absolute URL such as "https://notes.example.com".`);
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    check.fail(
      `${key} must be an origin such as "https://notes.example.com", without a path, query, ` +
        "or credentials. A base path comes from basePath.",
    );
  }
  if (url.protocol === "https:") return url.origin;
  if (url.protocol !== "http:") check.fail(`${key} must use https://, got "${url.protocol}".`);
  if (context.command !== "dev") {
    check.fail(
      `${key} must use https:// in a build, got "${value}". http:// is allowed only for ` +
        "loopback and LAN hosts in dev.",
    );
  }
  if (!isLoopbackOrLanHost(url.hostname)) {
    check.fail(
      `${key} may use http:// only for a loopback or LAN host (such as http://10.0.2.2:3000 ` +
        `for the Android emulator), got "${value}". Use https:// for public hosts.`,
    );
  }
  return url.origin;
}

function checkAppId(id: string, { fail }: PlatformBlockChecker): void {
  const segments = id.split(".");
  if (segments.length < 2 || !segments.every((segment) => APP_ID_SEGMENT.test(segment))) {
    fail(
      `id must be a reverse-DNS identifier such as "com.example.notes", with segments of letters ` +
        `and digits that start with a letter (valid on Android and iOS), got "${id}".`,
    );
  }
  const keyword = segments.find((segment) => JAVA_KEYWORDS.has(segment.toLowerCase()));
  if (keyword) fail(`id segment "${keyword}" is a Java keyword, which Android rejects.`);
}

/**
 * Check a returned or static `mobile` block's shape. Route and module existence are checked by
 * `resolveFarmMobileConfig`, which has the app's routes.
 */
export function validateFarmMobileConfig(
  input: unknown,
  context?: Pick<FarmMobileContext, "os" | "command">,
): FarmMobileUserConfig | undefined {
  const check = mobileChecker(context);
  const { checkKeys, optionalString } = check;
  function fail(message: string): never {
    return check.fail(message);
  }
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) {
    fail(
      context
        ? 'the function must return an object, such as { id: "com.example.notes" }.'
        : 'must be an object, such as { id: "com.example.notes" }, or a function that returns one.',
    );
  }
  checkKeys(input, MOBILE_KEYS, "");
  optionalString(input.name, "name");
  const id = optionalString(input.id, "id");
  if (id !== undefined) checkAppId(id, check);
  const server = optionalString(input.server, "server");
  if (server !== undefined) resolveFarmMobileServer(server, context ?? { command: "build" }, check);

  if (input.tabs !== undefined) {
    if (!Array.isArray(input.tabs)) {
      fail('tabs must be an array, such as [{ path: "/", title: "Home", icon: "home" }].');
    }
    const tabs: unknown[] = input.tabs;
    if (tabs.length > MAX_TABS) {
      fail(`tabs has ${tabs.length} entries; a tab bar shows at most ${MAX_TABS}.`);
    }
    const seen = new Set<string>();
    tabs.forEach((tab, index) => {
      const where = `tabs[${index}]`;
      if (!isPlainObject(tab)) {
        fail(`${where} must be an object, such as { path: "/", title: "Home", icon: "home" }.`);
      }
      checkKeys(tab, TAB_KEYS, `${where}.`);
      const { path: tabPath, title, icon } = tab;
      if (typeof tabPath !== "string" || !tabPath.startsWith("/")) {
        fail(`${where}.path must be a route path such as "/notes".`);
      }
      if (/[[\]()?#]/.test(tabPath)) {
        fail(`${where}.path must be a static route such as "/notes", got "${tabPath}".`);
      }
      if (seen.has(tabPath)) fail(`${where}.path "${tabPath}" is already a tab.`);
      seen.add(tabPath);
      if (optionalString(title, `${where}.title`) === undefined) {
        fail(`${where}.title must be a non-empty string.`);
      }
      const iconName = optionalString(icon, `${where}.icon`);
      if (iconName === undefined || !ICON_NAME.test(iconName)) {
        fail(
          `${where}.icon must be an icon name such as "note.text" or "ic_notes", got ` +
            `"${String(icon)}".`,
        );
      }
    });
  }

  if (input.routes !== undefined) {
    if (!isPlainObject(input.routes)) {
      fail(
        'routes must be an object keyed by route, such as { "/notes/new": { presentation: "modal" } }.',
      );
    }
    for (const [pattern, route] of Object.entries(input.routes)) {
      const where = `routes["${pattern}"]`;
      if (!pattern.startsWith("/"))
        fail(`${where}: the key must be an app route such as "/notes".`);
      if (!isPlainObject(route)) {
        fail(`${where} must be an object, such as { presentation: "modal" }.`);
      }
      checkKeys(route, ROUTE_KEYS, `${where}.`);
      const { presentation, native } = route;
      if (presentation !== undefined && !PRESENTATIONS.has(presentation as string)) {
        fail(`${where}.presentation must be "push", "modal", or "replace".`);
      }
      if (native !== undefined && (typeof native !== "string" || !NATIVE_MODULE.test(native))) {
        fail(
          `${where}.native must name a module in src/native/, such as "feed" for ` +
            `src/native/feed.tsx, got "${String(native)}".`,
        );
      }
    }
  }
  return input as FarmMobileUserConfig;
}

function stripRouteGroupsFromPattern(pattern: string): string {
  const segments = pattern
    .split("/")
    .filter((segment) => segment && !(segment.startsWith("(") && segment.endsWith(")")));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function safeShape(pattern: string): string | undefined {
  try {
    return getRoutePatternShape(pattern);
  } catch {
    return undefined;
  }
}

export interface FarmMobileResolveOptions {
  root: string;
  srcDir?: string;
  /** The app's page route patterns, such as `"/notes/[id]"` (route groups removed). */
  routes: readonly string[];
}

/**
 * Fill in defaults for an already resolved (static or returned) `mobile` block and check it
 * against the app: every tab and `routes` key must be an app route, and every `native` module
 * must exist in `src/native/`.
 */
export function resolveFarmMobileConfig(
  input: FarmMobileUserConfig | undefined,
  options: FarmMobileResolveOptions,
  context: Pick<FarmMobileContext, "os" | "command">,
): ResolvedFarmMobileConfig {
  const config = validateFarmMobileConfig(input, context) ?? {};
  const check = mobileChecker(context);
  function fail(message: string): never {
    return check.fail(message);
  }
  const pages = new Set(options.routes.map(stripRouteGroupsFromPattern));
  const byShape = new Map<string, string>();
  for (const page of pages) {
    const shape = safeShape(page);
    if (shape) byShape.set(shape, page);
  }

  const tabs = (config.tabs ?? []).map((tab, index) => {
    const tabPath = stripRouteGroupsFromPattern(tab.path);
    if (!pages.has(tabPath)) {
      fail(
        `tabs[${index}].path "${tab.path}" is not a page route. Add src/app${
          tabPath === "/" ? "" : tabPath
        }/page.tsx or pick an existing route.`,
      );
    }
    return { path: tabPath, title: tab.title.trim(), icon: tab.icon.trim() };
  });
  const tabPaths = new Set(tabs.map((tab) => tab.path));

  const routes: Record<string, FarmMobileRouteConfig> = {};
  const srcDir = options.srcDir || "src";
  for (const [key, route] of Object.entries(config.routes ?? {})) {
    const pattern = stripRouteGroupsFromPattern(key);
    if (!pages.has(pattern)) {
      const shape = safeShape(pattern);
      const sameShape = shape ? byShape.get(shape) : undefined;
      fail(
        sameShape
          ? `routes["${key}"] is not a page route; did you mean "${sameShape}"?`
          : `routes["${key}"] is not a page route. Keys are app route patterns such as "/notes/[id]".`,
      );
    }
    if (route.presentation !== undefined && tabPaths.has(pattern)) {
      fail(`routes["${key}"].presentation does not apply to a tab route; tabs switch in place.`);
    }
    if (route.native !== undefined) {
      const base = path.join(options.root, srcDir, "native", route.native);
      if (!NATIVE_EXTENSIONS.some((extension) => existsSync(base + extension))) {
        fail(
          `routes["${key}"].native "${route.native}" needs ${path.posix.join(
            srcDir.replace(/\\/g, "/"),
            "native",
            `${route.native}.tsx`,
          )}, which was not found.`,
        );
      }
    }
    routes[pattern] = {
      ...(route.presentation ? { presentation: route.presentation } : {}),
      ...(route.native ? { native: route.native } : {}),
    };
  }

  const pkg = readAppPackageJson(options.root);
  const name = config.name?.trim() || resolveAppPackageName(options.root, pkg) || "Farm App";
  const idName = name.replace(/[^A-Za-z0-9]+/g, "").replace(/^[^A-Za-z]+/, "") || "app";
  const id = config.id?.trim() || `local.farm.${idName.toLowerCase()}`;
  // The default comes from the app's name, which can be a Java keyword ("class", "new").
  if (!config.id?.trim()) {
    checkAppId(id, {
      ...check,
      fail: (message) =>
        fail(
          `${message} It comes from the app's name; set mobile.id, such as "com.example.notes".`,
        ),
    });
  }
  return {
    name,
    id,
    ...(config.server ? { server: resolveFarmMobileServer(config.server, context) } : {}),
    tabs,
    routes,
  };
}

export interface FarmMobileContextOptions {
  command: FarmMobileContext["command"];
  /** `--profile`; defaults to `"production"`. */
  profile?: string;
  /** Target OS; defaults to `"android"`, the first shell. */
  os?: FarmMobileOS;
  root: string;
  mode: FarmMobileContext["mode"];
}

/** The context a function-valued block receives. `env` is a frozen snapshot. */
export function createFarmMobileContext(options: FarmMobileContextOptions): FarmMobileContext {
  const os = options.os ?? "android";
  if (!MOBILE_OS.has(os)) throw new TypeError(`--os must be android or ios, got "${os}".`);
  if (options.command !== "dev" && options.command !== "build") {
    throw new TypeError(`--command must be dev or build, got "${options.command}".`);
  }
  return Object.freeze({
    os,
    mode: options.mode,
    command: options.command,
    profile: resolvePlatformProfile(options.profile),
    env: Object.freeze({ ...process.env }),
    root: options.root,
  });
}

/** Results of function-valued blocks for one dev session or build. */
export type FarmMobileBlockCache = PlatformBlockCache<FarmMobileUserConfig>;

/**
 * The plain `mobile` block for a context: the static object, or what the function returned.
 * Validated, with errors naming the OS and field. With a cache, the function runs once per
 * session and OS.
 */
export function resolveFarmMobileBlock(
  input: FarmMobileConfigInput,
  context: FarmMobileContext,
  cache?: FarmMobileBlockCache,
): Promise<FarmMobileUserConfig> {
  return resolvePlatformBlock(
    input,
    context,
    (value, ctx) => validateFarmMobileConfig(value, ctx) ?? {},
    cache,
  );
}
