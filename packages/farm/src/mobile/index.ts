/**
 * `@farm.js/core/mobile`: the interface mobile shell packages (such as `@farm.js/mobile/android`)
 * implement, and the types a page's `export const mobile` and a `mobile` block use. Types and an
 * identity helper only; nothing here runs in a web build.
 */
import type { FarmMobileOS, ResolvedFarmMobileConfig } from "./config";
import type { FarmMobileRouteManifest } from "./routes";

export type {
  FarmMobileBudgets,
  FarmMobileConfigInput,
  FarmMobileContext,
  FarmMobileNativeAuto,
  FarmMobileNativeConfig,
  FarmMobileNativeEngine,
  FarmMobileNativeRouteConfig,
  FarmMobileOS,
  FarmMobilePageConfig,
  FarmMobilePrefetch,
  FarmMobilePresentation,
  FarmMobileRouteConfig,
  FarmMobileScreen,
  FarmMobileTab,
  FarmMobileUserConfig,
  ResolvedFarmMobileConfig,
} from "./config";
export type { FarmMobileRouteManifest, FarmMobileRouteRule } from "./routes";

/** A file a mobile shell generates, relative to the native project directory. */
export interface MobileGeneratedFile {
  path: string;
  /** Text, or bytes for binary files such as the Gradle wrapper jar. */
  contents: string | Uint8Array;
  /** Written with the executable bit, such as `gradlew`. */
  executable?: boolean;
}

export interface MobileShellContext {
  /** App root. */
  root: string;
  os: FarmMobileOS;
  /** `"dev"` for `farm dev --mobile`, `"build"` for `farm build --mobile`. */
  command: "dev" | "build";
  mobile: ResolvedFarmMobileConfig;
  /** The app's basePath ("" or "/base"). */
  basePath: string;
  /** The navigator manifest, also written to `.farm/output/mobile/farm-routes.json`. */
  manifest: FarmMobileRouteManifest;
  /** Directory the native project is written to, such as `.farm/output/mobile/android`. */
  projectDir: string;
}

export interface MobilePackageContext extends MobileShellContext {
  /** Directory for built apps (`.farm/output/mobile/dist`). */
  distDir: string;
}

export interface MobileRunResult {
  /** True when the app was installed and opened on a device or emulator. */
  launched: boolean;
  /** What happened, or how to run the app when nothing was launched. */
  message: string;
}

/** What a mobile shell export (such as `@farm.js/mobile/android`) default-exports. */
export interface MobileShell {
  os: FarmMobileOS;
  /** The native project, written into `projectDir` on every `farm dev|build --mobile`. */
  generate(context: MobileShellContext): MobileGeneratedFile[] | Promise<MobileGeneratedFile[]>;
  /**
   * `farm dev --mobile`: build, install, and open the debug app when a device or emulator is
   * connected. Resolves with `launched: false` and the next commands when none is.
   */
  run(context: MobileShellContext): Promise<MobileRunResult>;
  /** Build an installable app from the generated project, such as a debug APK. */
  package(context: MobilePackageContext): Promise<{ files: string[] }>;
}

/** Typed helper for mobile shell packages. */
export function defineMobileShell(shell: MobileShell): MobileShell {
  return shell;
}
