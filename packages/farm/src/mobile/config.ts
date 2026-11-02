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
  /** Defaults to `"push"`. A page's `export const mobile` wins. */
  presentation?: FarmMobilePresentation;
}

/**
 * What a route shows on mobile: a WebView of the web page (`"web"`), a screen from the
 * `mobile.native.engine` (`"native"`), or a Compose or SwiftUI screen from `page.kt` or
 * `page.swift` (`"platform"`).
 */
export type FarmMobileScreen = "web" | "native" | "platform";

/** What builds native screens. Only the decision is recorded for now; no engine ships yet. */
export type FarmMobileNativeEngine = "react-native" | "platform";

/**
 * The build-time analyzer that finds pages a native screen could replace. `"report"` writes
 * `native-report.json`; `"on"` also records its decisions in the route manifest.
 */
export type FarmMobileNativeAuto = "off" | "report" | "on";

/** `"intent"` starts a route's data request when a link to it is pressed. */
export type FarmMobilePrefetch = "intent" | "off";

export interface FarmMobileNativeRouteConfig {
  /**
   * Wins over the route's native files and the analyzer. `"native"` uses `page.native.tsx` (or
   * the OS file) and otherwise asks the analyzer to port the page; `"platform"` needs `page.kt`
   * or `page.swift`; `"web"` keeps the route web even when native files exist.
   */
  screen: FarmMobileScreen;
  /** Overrides `screen` on Android. */
  android?: FarmMobileScreen;
  /** Overrides `screen` on iOS. */
  ios?: FarmMobileScreen;
  /** Defaults to `"push"`. Set it here or in `mobile.routes`, not both. */
  presentation?: FarmMobilePresentation;
}

export interface FarmMobileBudgets {
  /** Installed app size, in MB. */
  appSizeMb?: number;
  /** Time from a tap to the next screen's first frame, in ms. */
  screenOpenMs?: number;
  /** Dropped frames allowed per screen open. */
  droppedFrames?: number;
}

export interface FarmMobileNativeConfig {
  /** Defaults to `"react-native"`. */
  engine?: FarmMobileNativeEngine;
  /** Defaults to `"report"`. */
  auto?: FarmMobileNativeAuto;
  /** Per-route screens and navigation, keyed by app route pattern such as `"/notes/[id]"`. */
  routes?: Record<string, FarmMobileNativeRouteConfig>;
  /**
   * Components that may render as native views inside web screens, such as `"Map"`. Reserved:
   * no islands render yet.
   */
  islands?: string[];
  /** Default for every route; a page's `export const mobile` wins. Defaults to `"intent"`. */
  prefetch?: FarmMobilePrefetch;
  budgets?: FarmMobileBudgets;
}

/**
 * A page's `export const mobile = { ... }`, read from `page.tsx` without running it, so its
 * values must be literals.
 */
export interface FarmMobilePageConfig {
  presentation?: FarmMobilePresentation;
  prefetch?: FarmMobilePrefetch;
  /** `false` keeps the route a web screen, even with a `page.native.tsx`. */
  native?: false;
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
  /** Screen tiers per route, the native engine, and the analyzer. */
  native?: FarmMobileNativeConfig;
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

export interface ResolvedFarmMobileNativeConfig {
  engine: FarmMobileNativeEngine;
  auto: FarmMobileNativeAuto;
  /** Keyed by route pattern with route groups removed. */
  routes: Record<string, FarmMobileNativeRouteConfig>;
  islands: string[];
  prefetch: FarmMobilePrefetch;
  budgets: FarmMobileBudgets;
}

export interface ResolvedFarmMobileConfig {
  name: string;
  id: string;
  /** Origin, without a trailing slash. Undefined only when the CLI supplies one (dev). */
  server?: string;
  tabs: FarmMobileTab[];
  /** `mobile.routes`, keyed by route pattern with route groups removed. */
  routes: Record<string, FarmMobileRouteConfig>;
  native: ResolvedFarmMobileNativeConfig;
}

const MOBILE_KEYS = new Set(["name", "id", "server", "tabs", "routes", "native"]);
const ROUTE_KEYS = new Set(["presentation"]);
const TAB_KEYS = new Set(["path", "title", "icon"]);
const NATIVE_KEYS = new Set(["engine", "auto", "routes", "islands", "prefetch", "budgets"]);
const NATIVE_ROUTE_KEYS = new Set(["screen", "android", "ios", "presentation"]);
const BUDGET_KEYS = new Set(["appSizeMb", "screenOpenMs", "droppedFrames"]);
const PAGE_KEYS = new Set(["presentation", "prefetch", "native"]);
const PRESENTATIONS = new Set(["push", "modal", "replace"]);
const SCREENS = new Set(["web", "native", "platform"]);
const ENGINES = new Set(["react-native", "platform"]);
const AUTO_MODES = new Set(["off", "report", "on"]);
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
const ISLAND_NAME = /^[A-Z][A-Za-z0-9]*$/;

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

/** #2420's `routes[x].native: "<module>"`, replaced by `page.native.tsx` before release. */
function nativeModuleMovedMessage(where: string, pattern: string): string {
  const dir = pattern === "/" ? "" : stripRouteGroupsFromPattern(pattern);
  return (
    `${where}.native no longer names a src/native/ module (src/native/ is for native module ` +
    `specs). Add src/app${dir}/page.native.tsx next to its page.tsx, or set ` +
    `native: { routes: { "${pattern}": { screen: "native" } } }.`
  );
}

function checkRouteKey(pattern: string, where: string, { fail }: PlatformBlockChecker): void {
  if (!pattern.startsWith("/")) fail(`${where}: the key must be an app route such as "/notes".`);
}

function checkPresentation(value: unknown, where: string, { fail }: PlatformBlockChecker): void {
  if (value !== undefined && !PRESENTATIONS.has(value as string)) {
    fail(`${where}.presentation must be "push", "modal", or "replace".`);
  }
}

function checkPrefetch(value: unknown, where: string, { fail }: PlatformBlockChecker): void {
  if (value !== undefined && value !== "intent" && value !== "off") {
    fail(`${where}prefetch must be "intent" or "off".`);
  }
}

function validateNativeConfig(native: unknown, check: PlatformBlockChecker): void {
  const { checkKeys } = check;
  function fail(message: string): never {
    return check.fail(message);
  }
  if (!isPlainObject(native)) {
    fail('native must be an object, such as { routes: { "/feed": { screen: "native" } } }.');
  }
  checkKeys(native, NATIVE_KEYS, "native.");
  if (native.engine !== undefined && !ENGINES.has(native.engine as string)) {
    fail('native.engine must be "react-native" or "platform".');
  }
  if (native.auto !== undefined && !AUTO_MODES.has(native.auto as string)) {
    fail('native.auto must be "off", "report", or "on".');
  }
  checkPrefetch(native.prefetch, "native.", check);
  if (native.islands !== undefined) {
    if (
      !Array.isArray(native.islands) ||
      !native.islands.every((entry) => typeof entry === "string" && ISLAND_NAME.test(entry))
    ) {
      fail('native.islands must be an array of component names, such as ["Map", "Video"].');
    }
  }
  if (native.budgets !== undefined) {
    if (!isPlainObject(native.budgets)) {
      fail("native.budgets must be an object, such as { screenOpenMs: 300 }.");
    }
    checkKeys(native.budgets, BUDGET_KEYS, "native.budgets.");
    for (const [key, value] of Object.entries(native.budgets)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        fail(`native.budgets.${key} must be a number of 0 or more.`);
      }
    }
  }
  if (native.routes === undefined) return;
  if (!isPlainObject(native.routes)) {
    fail(
      "native.routes must be an object keyed by route, such as " +
        '{ "/notes/new": { presentation: "modal" } }.',
    );
  }
  for (const [pattern, route] of Object.entries(native.routes)) {
    const where = `native.routes["${pattern}"]`;
    checkRouteKey(pattern, where, check);
    if (!isPlainObject(route)) fail(`${where} must be an object, such as { screen: "native" }.`);
    if (typeof route.native === "string") fail(nativeModuleMovedMessage(where, pattern));
    checkKeys(route, NATIVE_ROUTE_KEYS, `${where}.`);
    if (route.screen === undefined) {
      fail(`${where}.screen is required: "web", "native", or "platform".`);
    }
    for (const field of ["screen", "android", "ios"] as const) {
      if (route[field] !== undefined && !SCREENS.has(route[field] as string)) {
        fail(`${where}.${field} must be "web", "native", or "platform".`);
      }
    }
    checkPresentation(route.presentation, where, check);
  }
}

/**
 * Check a page's `export const mobile` value, already read from its source. `where` names the
 * file in errors.
 */
export function validateFarmMobilePageConfig(
  value: unknown,
  where: string,
  context?: Pick<FarmMobileContext, "os">,
): FarmMobilePageConfig {
  const check = mobileChecker(context);
  const { checkKeys } = check;
  function fail(message: string): never {
    return check.fail(message);
  }
  if (!isPlainObject(value)) {
    fail(`${where}: export const mobile must be an object, such as { presentation: "modal" }.`);
  }
  checkKeys(value, PAGE_KEYS, `${where}: mobile.`);
  checkPresentation(value.presentation, `${where}: mobile`, check);
  checkPrefetch(value.prefetch, `${where}: mobile.`, check);
  if (value.native !== undefined && value.native !== false) {
    fail(
      `${where}: mobile.native can only be false. A native screen comes from a ` +
        "page.native.tsx next to the page.",
    );
  }
  return value as FarmMobilePageConfig;
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
      checkRouteKey(pattern, where, check);
      if (!isPlainObject(route)) {
        fail(`${where} must be an object, such as { presentation: "modal" }.`);
      }
      if (route.native !== undefined) fail(nativeModuleMovedMessage(where, pattern));
      checkKeys(route, ROUTE_KEYS, `${where}.`);
      checkPresentation(route.presentation, where, check);
    }
  }
  if (input.native !== undefined) validateNativeConfig(input.native, check);
  // One presentation per route: mobile.routes and mobile.native.routes share the field.
  if (isPlainObject(input.routes) && isPlainObject(input.native)) {
    const nativeRoutes = isPlainObject(input.native.routes) ? input.native.routes : {};
    const presented = new Map(
      Object.entries(input.routes)
        .filter(([, route]) => isPlainObject(route) && route.presentation !== undefined)
        .map(([pattern]) => [stripRouteGroupsFromPattern(pattern), pattern]),
    );
    for (const [pattern, route] of Object.entries(nativeRoutes)) {
      const other = presented.get(stripRouteGroupsFromPattern(pattern));
      if (other !== undefined && isPlainObject(route) && route.presentation !== undefined) {
        fail(
          `routes["${other}"].presentation and native.routes["${pattern}"].presentation set the ` +
            "same field. Keep one.",
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
 * against the app: every tab, `routes`, and `native.routes` key must be a page route.
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

  const checkPage = (key: string, where: string): string => {
    const pattern = stripRouteGroupsFromPattern(key);
    if (!pages.has(pattern)) {
      const shape = safeShape(pattern);
      const sameShape = shape ? byShape.get(shape) : undefined;
      fail(
        sameShape
          ? `${where} is not a page route; did you mean "${sameShape}"?`
          : `${where} is not a page route. Keys are app route patterns such as "/notes/[id]".`,
      );
    }
    return pattern;
  };
  const checkTabPresentation = (pattern: string, where: string, presentation: unknown) => {
    if (presentation !== undefined && tabPaths.has(pattern)) {
      fail(`${where}.presentation does not apply to a tab route; tabs switch in place.`);
    }
  };

  const routes: Record<string, FarmMobileRouteConfig> = {};
  for (const [key, route] of Object.entries(config.routes ?? {})) {
    const where = `routes["${key}"]`;
    const pattern = checkPage(key, where);
    checkTabPresentation(pattern, where, route.presentation);
    routes[pattern] = route.presentation ? { presentation: route.presentation } : {};
  }

  const native = config.native ?? {};
  const nativeRoutes: Record<string, FarmMobileNativeRouteConfig> = {};
  for (const [key, route] of Object.entries(native.routes ?? {})) {
    const where = `native.routes["${key}"]`;
    const pattern = checkPage(key, where);
    checkTabPresentation(pattern, where, route.presentation);
    nativeRoutes[pattern] = Object.fromEntries(
      (["screen", "android", "ios", "presentation"] as const)
        .filter((field) => route[field] !== undefined)
        .map((field) => [field, route[field]]),
    ) as unknown as FarmMobileNativeRouteConfig;
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
    native: {
      engine: native.engine ?? "react-native",
      auto: native.auto ?? "report",
      routes: nativeRoutes,
      islands: [...new Set(native.islands ?? [])].sort(),
      prefetch: native.prefetch ?? "intent",
      budgets: { ...native.budgets },
    },
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
