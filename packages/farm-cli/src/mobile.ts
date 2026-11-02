import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MobileShell, MobileShellContext } from "@farm.js/core/mobile";
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

/** Only Android has a shell so far. */
const MOBILE_OS = "android" as const;
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
 * `10.0.2.2`, which `farm dev` listens on by default; `--host <address>` picks a LAN address
 * for a device instead.
 */
export function formatMobileDevServer(host: string | boolean | undefined, port: number): string {
  const wildcard = new Set(["0.0.0.0", "::", "localhost", "127.0.0.1", "::1"]);
  if (typeof host === "string" && host && !wildcard.has(host)) {
    return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
  }
  return `http://10.0.2.2:${port}`;
}

type ConfigRuntime = typeof import("@farm.js/core/internal/config-runtime");
type MobileRuntime = Awaited<ReturnType<ConfigRuntime["loadFarmMobileRuntime"]>>;
type MobileApp = Awaited<ReturnType<MobileRuntime["generateFarmMobileRoutes"]>>;

async function writeMobileProject(
  shell: MobileShell,
  app: MobileApp,
  command: "dev" | "build",
  runtime: MobileRuntime,
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
}

/**
 * `farm dev --mobile`: the dev server with a `--mobile` client, farm-routes.json pointed at it,
 * and the generated Android project, installed and opened when a device or emulator is connected.
 * The dev server keeps running after the app opens.
 */
export async function devFarmMobile(options: FarmMobileDevOptions = {}) {
  const root = path.resolve(options.root || process.cwd());
  setFarmPlatform("mobile");
  const runtime = await import("@farm.js/core/internal/config-runtime");
  const mobileRuntime = await runtime.loadFarmMobileRuntime();
  const cache = new Map();
  const appOptions = {
    root,
    command: "dev" as const,
    profile: options.profile,
    os: MOBILE_OS,
    cache,
  };
  // Check the block before the server starts, so a config error is not buried under its banner.
  await mobileRuntime.resolveFarmMobileApp({
    ...appOptions,
    server: formatMobileDevServer(options.host, options.port ?? 3000),
  });
  const shell = await loadFarmMobileShell(MOBILE_OS, root);

  const { startDevServer } = await import("./dev");
  const server = await startDevServer({ root }, options.port, options.host);
  try {
    const address = server.httpServer?.address();
    if (!address || typeof address !== "object") {
      throw new FarmMobileError("The dev server did not report its port.");
    }
    const app = await mobileRuntime.generateFarmMobileRoutes({
      ...appOptions,
      server: formatMobileDevServer(options.host, address.port),
    });
    for (const warning of app.warnings) runtime.logger.warn(warning);
    const context = await writeMobileProject(shell, app, "dev", mobileRuntime);
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
  /** Also build the debug app from the generated project (`./gradlew assembleDebug`). */
  apk?: boolean;
}

/**
 * `farm build --mobile`: the `--mobile` client build, farm-routes.json with `mobile.server`, and
 * the generated Android project. The web build's output is left alone.
 */
export async function buildFarmMobile(options: FarmMobileBuildOptions = {}): Promise<string[]> {
  const root = path.resolve(options.root || process.cwd());
  return withProductionNodeEnv(async () => {
    setFarmPlatform("mobile");
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
      os: MOBILE_OS,
      userConfig,
      cache: new Map(),
    };
    // Fails on a missing or invalid block (such as an http server) before anything builds.
    await mobileRuntime.resolveFarmMobileApp(appOptions);
    const shell = await loadFarmMobileShell(MOBILE_OS, root);

    const config = await runtime.resolveConfig(
      { ...userConfig, root: userConfig?.root ?? root },
      "production",
    );
    const dirs = mobileRuntime.getFarmMobileOutputDirs(config.distDir);
    // The mobile client build goes next to the native project, never over the web output.
    config.preset = "node-server";
    config.deploy = runtime.resolveDeployConfig(userConfig ?? {}, {
      preset: "node-server",
      outputDir: dirs.www,
      env: {},
    });
    const { build } = await import("@farm.js/core/internal/build-runtime");
    await build(config, { preset: "node-server", root, productionVite });

    // The analyzer runs unless mobile.native.auto is "off"; it only reports.
    const app = await mobileRuntime.generateFarmMobileRoutes({
      ...appOptions,
      config,
      analyze: true,
    });
    if (app.table) console.log(app.table);
    // Unused native files and config ports nothing builds yet: the same as config inspect.
    for (const warning of app.warnings) runtime.logger.warn(warning);
    const context = await writeMobileProject(shell, app, "build", mobileRuntime);
    runtime.logger.info(`📱 ${shownPath(root, context.projectDir)} (${shell.os} project)`);
    if (!options.apk) {
      runtime.logger.info("Run farm build --mobile --apk to build the debug app.");
      return [context.projectDir];
    }
    const { files } = await shell.package({ ...context, distDir: path.resolve(root, dirs.dist) });
    for (const file of files) runtime.logger.info(`📦 ${shownPath(root, file)}`);
    return files;
  });
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
