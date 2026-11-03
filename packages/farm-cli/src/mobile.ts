import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import type {
  MobileBundledAssets,
  MobileNativeScreens,
  MobileShell,
  MobileShellContext,
} from "@farm.js/core/mobile";
import { withProductionNodeEnv } from "@farm.js/core/internal/production-node-env";
import { formatDesktopShellInstallCommand, setFarmPlatform, writeShellFiles } from "./desktop";

/** An expected failure with its own fix; the CLI prints it without a stack. */
export class FarmMobileError extends Error {
  override name = "FarmMobileError";
}

export interface FarmMobileInspectOptions {
  root?: string;
  os?: "android" | "ios";
  profile?: string;
  command?: "dev" | "build";
}

/**
 * `farm config inspect --mobile`: the `mobile` block a dev session or build would use for an OS
 * and profile, each route's screen and what decided it, and the `farm-routes.json` navigator
 * manifest it produces. Writes nothing.
 */
export async function inspectFarmMobileConfig(options: FarmMobileInspectOptions = {}) {
  const root = path.resolve(options.root || process.cwd());
  const configRuntime = await import("@farm.js/core/internal/config-runtime");
  const { resolveFarmMobileApp } = await configRuntime.loadFarmMobileRuntime();
  const { context, mobile, manifest, screens, warnings, nativeLayouts } =
    await resolveFarmMobileApp({
      root,
      os: options.os,
      profile: options.profile,
      command: options.command,
    });
  return {
    context: {
      os: context.os,
      mode: context.mode,
      command: context.command,
      profile: context.profile,
    },
    mobile,
    // What each page route shows on this OS and what decided it: page, config, file, analyzer,
    // or default.
    screens: Object.fromEntries(
      Object.entries(screens).map(([route, decision]) => [
        route,
        {
          screen: decision.screen,
          source: decision.source,
          ...(decision.file ? { file: decision.file } : {}),
          ...(decision.module ? { module: decision.module } : {}),
          ...(decision.requested ? { requested: decision.requested } : {}),
          presentation: decision.presentation,
        },
      ]),
    ),
    ...(Object.keys(nativeLayouts).length > 0 ? { nativeLayouts } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    routes: manifest,
  };
}

export type FarmMobileShellOS = "android" | "ios";

/** `--os` for `farm dev|build --mobile`; Android when omitted. */
export function resolveMobileOS(os: string | undefined): FarmMobileShellOS {
  if (os === undefined || os === "android") return "android";
  if (os === "ios") return "ios";
  throw new FarmMobileError(`--os must be android or ios, not ${JSON.stringify(os)}.`);
}

const MOBILE_SHELL_PACKAGE = "@farm.js/mobile";

function isMobileShell(value: unknown): value is MobileShell {
  const shell = value as Partial<MobileShell> | null;
  return (
    !!shell &&
    typeof shell === "object" &&
    typeof shell.os === "string" &&
    typeof shell.generate === "function" &&
    typeof shell.run === "function" &&
    typeof shell.package === "function"
  );
}

/** Import `@farm.js/mobile/<os>` from the app, or say how to install it. */
export async function loadFarmMobileShell(os: string, root: string): Promise<MobileShell> {
  const specifier = `${MOBILE_SHELL_PACKAGE}/${os}`;
  let entry: string;
  try {
    entry = createRequire(path.join(root, "package.json")).resolve(specifier);
  } catch {
    throw new FarmMobileError(
      `--mobile needs ${MOBILE_SHELL_PACKAGE}, which is not installed in ${root}.\n` +
        `Install it:\n  ${formatDesktopShellInstallCommand(root, MOBILE_SHELL_PACKAGE)}`,
    );
  }
  const shell = ((await import(pathToFileURL(entry).href)) as { default?: unknown }).default;
  if (!isMobileShell(shell)) {
    throw new FarmMobileError(
      `${specifier} does not default-export a mobile shell (os, generate, run, package).`,
    );
  }
  return shell;
}

/**
 * The dev server URL the app loads. An Android emulator reaches the host's loopback as
 * `10.0.2.2`, which `farm dev` listens on by default; an iOS simulator shares the host's network,
 * so it uses `localhost`. `--host <address>` picks a LAN address for a device instead.
 */
export function formatMobileDevServer(
  host: string | boolean | undefined,
  port: number,
  os: FarmMobileShellOS = "android",
): string {
  const wildcard = new Set(["0.0.0.0", "::", "localhost", "127.0.0.1", "::1"]);
  if (typeof host === "string" && host && !wildcard.has(host)) {
    return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
  }
  return os === "ios" ? `http://localhost:${port}` : `http://10.0.2.2:${port}`;
}

const NATIVE_PACKAGE = "@farm.js/native";

interface NativeScreensOptions {
  root: string;
  outDir: string;
  screens: FarmMobileNativeScreen[];
  basePath: string;
  locales?: string[];
}

interface ReactNativeInfo {
  version: string;
  hermesVersion: string;
}

/** What the CLI uses of `@farm.js/native/build`, which is loaded from the app at run time. */
interface NativeBuildModule {
  buildFarmNativeScreens(options: NativeScreensOptions): Promise<{
    reactNative: ReactNativeInfo;
    bundle: string;
    jsBytes: number;
    bytecodeBytes: number;
    bundleMs: number;
    hermesMs: number;
  }>;
  startFarmNativeDevServer(options: NativeScreensOptions & { port?: number }): Promise<{
    reactNative: ReactNativeInfo;
    port: number;
    mainModule: string;
    close(): Promise<void>;
  }>;
}

/** Import `@farm.js/native/build` from the app, or say how to install it. */
export async function loadFarmNativeBuild(root: string): Promise<NativeBuildModule> {
  let entry: string;
  try {
    entry = createRequire(path.join(root, "package.json")).resolve(`${NATIVE_PACKAGE}/build`);
  } catch {
    throw new FarmMobileError(
      `page.native.tsx screens need ${NATIVE_PACKAGE}, React Native, and its Metro config, ` +
        `which are not installed in ${root}.\nInstall them:\n  ` +
        formatDesktopShellInstallCommand(
          root,
          `${NATIVE_PACKAGE} react-native@^0.88 @react-native/metro-config@^0.88`,
        ),
    );
  }
  return (await import(pathToFileURL(entry).href)) as NativeBuildModule;
}

export interface FarmMobileNativeScreen {
  module: string;
  route: string;
  /** Absolute screen file. */
  file: string;
}

/**
 * The routes that render as React Native screens on this OS. Empty for apps without any, and on
 * iOS, whose shell does not host React Native yet and shows a placeholder; those load nothing of
 * React Native and generate the same project as before.
 */
export function listFarmMobileNativeScreens(
  app: {
    config: { root: string };
    screens: Record<string, { screen: string; module?: string; file?: string }>;
  },
  os: FarmMobileShellOS = "android",
): FarmMobileNativeScreen[] {
  if (os !== "android") return [];
  return Object.entries(app.screens)
    .filter(([, decision]) => decision.screen === "native" && decision.module && decision.file)
    .map(([route, decision]) => ({
      module: decision.module!,
      route,
      file: path.resolve(app.config.root, decision.file!),
    }));
}

function nativeLocales(config: { i18n?: unknown }): string[] | undefined {
  const i18n = config.i18n as
    | { enabled?: boolean; locales?: string[]; routing?: string }
    | undefined;
  return i18n && typeof i18n === "object" && i18n.enabled && i18n.routing !== "none"
    ? i18n.locales
    : undefined;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port);
  });
}

/** React Native's default Metro port, or the next free one. */
async function findMetroPort(start = 8081): Promise<number> {
  for (let port = start; port < start + 20; port++) if (await isPortFree(port)) return port;
  throw new FarmMobileError(`No free port for Metro between ${start} and ${start + 19}.`);
}

type ConfigRuntime = typeof import("@farm.js/core/internal/config-runtime");
type MobileRuntime = Awaited<ReturnType<ConfigRuntime["loadFarmMobileRuntime"]>>;
type MobileApp = Awaited<ReturnType<MobileRuntime["generateFarmMobileRoutes"]>>;

async function writeMobileProject(
  shell: MobileShell,
  app: MobileApp,
  command: "dev" | "build",
  runtime: MobileRuntime,
  native?: MobileNativeScreens,
  assets?: MobileBundledAssets,
): Promise<MobileShellContext> {
  const { config } = app;
  const context: MobileShellContext = {
    root: config.root,
    os: app.context.os,
    command,
    mobile: app.mobile,
    basePath: config.basePath === "/" ? "" : config.basePath,
    manifest: app.manifest,
    projectDir: path.resolve(
      config.root,
      runtime.getFarmMobileOutputDirs(config.distDir)[app.context.os],
    ),
    ...(native ? { native } : {}),
    ...(assets ? { assets } : {}),
  };
  await writeShellFiles(
    context.projectDir,
    await shell.generate(context),
    (message) => new FarmMobileError(message),
  );
  return context;
}

function shownPath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export interface FarmMobileDevOptions {
  root?: string;
  port?: number;
  host?: string | boolean;
  profile?: string;
  /** `"android"` (default) or `"ios"`. */
  os?: string;
}

/**
 * `farm dev --mobile`: the dev server with a `--mobile` client, farm-routes.json pointed at it,
 * and the generated native project for `--os`, installed and opened when a device, emulator, or
 * booted simulator is there. The dev server keeps running after the app opens.
 */
export async function devFarmMobile(options: FarmMobileDevOptions = {}) {
  const root = path.resolve(options.root || process.cwd());
  const os = resolveMobileOS(options.os);
  setFarmPlatform("mobile");
  const runtime = await import("@farm.js/core/internal/config-runtime");
  const mobileRuntime = await runtime.loadFarmMobileRuntime();
  const cache = new Map();
  const appOptions = {
    root,
    command: "dev" as const,
    profile: options.profile,
    os,
    cache,
  };
  // Check the block before the server starts, so a config error is not buried under its banner.
  const preflight = await mobileRuntime.resolveFarmMobileApp({
    ...appOptions,
    server: formatMobileDevServer(options.host, options.port ?? 3000, os),
  });
  const shell = await loadFarmMobileShell(os, root);
  // Only an app with React Native screens loads React Native's tooling, and before the server.
  let nativeBuild =
    listFarmMobileNativeScreens(preflight, os).length > 0
      ? await loadFarmNativeBuild(root)
      : undefined;

  const { startDevServer } = await import("./dev");
  const server = await startDevServer({ root }, options.port, options.host);
  try {
    const address = server.httpServer?.address();
    if (!address || typeof address !== "object") {
      throw new FarmMobileError("The dev server did not report its port.");
    }
    const app = await mobileRuntime.generateFarmMobileRoutes({
      ...appOptions,
      server: formatMobileDevServer(options.host, address.port, os),
    });
    for (const warning of app.warnings) runtime.logger.warn(warning);
    let native: MobileNativeScreens | undefined;
    const screens = listFarmMobileNativeScreens(app, os);
    if (screens.length > 0) {
      nativeBuild ??= await loadFarmNativeBuild(root);
      const metro = await nativeBuild.startFarmNativeDevServer({
        root,
        outDir: path.resolve(
          root,
          mobileRuntime.getFarmMobileOutputDirs(app.config.distDir).root,
          "native",
        ),
        screens,
        basePath: app.config.basePath === "/" ? "" : app.config.basePath,
        locales: nativeLocales(app.config),
        port: await findMetroPort(),
      });
      // Metro stops with the dev server.
      const close = server.close.bind(server);
      server.close = async () => {
        await metro.close();
        return close();
      };
      native = {
        engine: "react-native",
        reactNativeVersion: metro.reactNative.version,
        hermesVersion: metro.reactNative.hermesVersion,
        modules: screens.map((screen) => screen.module),
        devServer: { port: metro.port, mainModule: metro.mainModule },
      };
      runtime.logger.info(
        `React Native ${metro.reactNative.version}: ${screens.length} native screen` +
          `${screens.length === 1 ? "" : "s"} from Metro on port ${metro.port}`,
      );
    }
    const context = await writeMobileProject(shell, app, "dev", mobileRuntime, native);
    runtime.logger.info(
      `Mobile app (${shell.os}) on ${app.manifest.server}; project in ${shownPath(root, context.projectDir)}`,
    );
    const result = await shell.run(context);
    runtime.logger.info(result.message);
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}

export interface FarmMobileBuildOptions {
  root?: string;
  profile?: string;
  /** `"android"` (default) or `"ios"`. */
  os?: string;
  /** Android: also build the debug app from the generated project (`./gradlew assembleDebug`). */
  apk?: boolean;
}

/**
 * `farm build --mobile`: the production build a web deployment of the app makes, which includes
 * the mobile client, written apart from the web output; farm-routes.json with `mobile.server`; and
 * the generated native project for `--os` with the mobile client's files bundled. On iOS it also
 * builds the simulator app when Xcode is installed, and says what to install when it is not.
 */
export async function buildFarmMobile(options: FarmMobileBuildOptions = {}): Promise<string[]> {
  const root = path.resolve(options.root || process.cwd());
  const os = resolveMobileOS(options.os);
  if (options.apk && os !== "android") {
    throw new FarmMobileError("--apk builds the Android app; it is not available with --os ios.");
  }
  return withProductionNodeEnv(async () => {
    // The same build as the web deployment's, so the mobile client's content-hashed names match
    // the ones its documents reference. That build adds the mobile client itself.
    setFarmPlatform("web");
    const runtime = await import("@farm.js/core/internal/config-runtime");
    const productionVite = await runtime.loadFarmProductionVite();
    const userConfig = await runtime.loadConfig(
      root,
      undefined,
      "production",
      productionVite.loadEnv,
    );
    const mobileRuntime = await runtime.loadFarmMobileRuntime();
    const appOptions = {
      root,
      command: "build" as const,
      profile: options.profile,
      os,
      userConfig,
      cache: new Map(),
    };
    // Fails on a missing or invalid block (such as an http server) before anything builds.
    const preflight = await mobileRuntime.resolveFarmMobileApp(appOptions);
    const shell = await loadFarmMobileShell(os, root);
    // Only an app with React Native screens loads React Native's tooling, and before building.
    let nativeBuild =
      listFarmMobileNativeScreens(preflight, os).length > 0
        ? await loadFarmNativeBuild(root)
        : undefined;

    const config = await runtime.resolveConfig(
      { ...userConfig, root: userConfig?.root ?? root },
      "production",
    );
    const dirs = mobileRuntime.getFarmMobileOutputDirs(config.distDir);
    // The build goes next to the native project, never over the web output.
    config.preset = "node-server";
    config.deploy = runtime.resolveDeployConfig(userConfig ?? {}, {
      preset: "node-server",
      outputDir: dirs.www,
      env: {},
    });
    const { build } = await import("@farm.js/core/internal/build-runtime");
    await build(config, { preset: "node-server", root, productionVite });
    const assets = await readBundledAssets(root, config.distDir, mobileRuntime);
    if (assets) {
      // WKWebView cannot answer https requests from the app, so iOS loads the files from the
      // server, where WebKit's cache keeps them (RFC 0004, decisions).
      runtime.logger.info(
        os === "android"
          ? `Mobile client ${assets.entry}: ${assets.files.length} files bundled into the app`
          : `Mobile client ${assets.entry}: loaded from the server (iOS does not bundle it yet)`,
      );
    } else {
      runtime.logger.warn(
        "This build has no mobile client, so the app loads its client from the server and " +
          "navigations stay in the page (server components apps do not get one yet).",
      );
    }

    // The analyzer runs unless mobile.native.auto is "off"; it only reports.
    const app = await mobileRuntime.generateFarmMobileRoutes({
      ...appOptions,
      config,
      analyze: true,
    });
    if (app.table) console.log(app.table);
    // Unused native files and config ports nothing builds yet: the same as config inspect.
    for (const warning of app.warnings) runtime.logger.warn(warning);
    let native: MobileNativeScreens | undefined;
    const screens = listFarmMobileNativeScreens(app, os);
    if (screens.length > 0) {
      nativeBuild ??= await loadFarmNativeBuild(root);
      const built = await nativeBuild.buildFarmNativeScreens({
        root,
        outDir: path.resolve(root, dirs.root, "native"),
        screens,
        basePath: config.basePath === "/" ? "" : config.basePath,
        locales: nativeLocales(config),
      });
      native = {
        engine: "react-native",
        reactNativeVersion: built.reactNative.version,
        hermesVersion: built.reactNative.hermesVersion,
        modules: screens.map((screen) => screen.module),
        bundle: built.bundle,
      };
      const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
      runtime.logger.info(
        `React Native ${built.reactNative.version}: ${screens.length} native screen` +
          `${screens.length === 1 ? "" : "s"}, ${kb(built.jsBytes)} JS, ${kb(built.bytecodeBytes)} ` +
          `Hermes bytecode (Metro ${Math.round(built.bundleMs)} ms, hermesc ` +
          `${Math.round(built.hermesMs)} ms)`,
      );
    }
    const context = await writeMobileProject(shell, app, "build", mobileRuntime, native, assets);
    runtime.logger.info(`📱 ${shownPath(root, context.projectDir)} (${shell.os} project)`);
    if (os === "android" && !options.apk) {
      runtime.logger.info("Run farm build --mobile --apk to build the debug app.");
      return [context.projectDir];
    }
    const { files, message } = await shell.package({
      ...context,
      distDir: path.resolve(root, dirs.dist),
    });
    for (const file of files) runtime.logger.info(`📦 ${shownPath(root, file)}`);
    if (message) runtime.logger.info(message);
    return files.length > 0 ? files : [context.projectDir];
  });
}

/** The finished build's mobile client, as the shell bundles it; undefined when it has none. */
async function readBundledAssets(
  root: string,
  distDir: string,
  runtime: MobileRuntime,
): Promise<MobileBundledAssets | undefined> {
  const buildDir = path.resolve(root, distDir);
  const manifest = await runtime.readFarmMobileClientManifest(buildDir);
  if (!manifest) return undefined;
  return {
    dir: path.resolve(root, runtime.getFarmMobileOutputDirs(distDir).client),
    files: manifest.files,
    entry: manifest.entry,
  };
}

/**
 * `farm config inspect --mobile --report`: run the build-time analyzer, write
 * `farm-routes.json` and `native-report.json`, and return the report table. Runs even when
 * `mobile.native.auto` is `"off"`, since it was asked for.
 */
export async function reportFarmMobileNative(options: FarmMobileInspectOptions = {}) {
  const root = path.resolve(options.root || process.cwd());
  const configRuntime = await import("@farm.js/core/internal/config-runtime");
  const { generateFarmMobileRoutes } = await configRuntime.loadFarmMobileRuntime();
  const { table, warnings, reportFile } = await generateFarmMobileRoutes({
    root,
    os: options.os,
    profile: options.profile,
    command: options.command,
    analyze: "always",
  });
  return { table: table ?? "", warnings, reportFile };
}
