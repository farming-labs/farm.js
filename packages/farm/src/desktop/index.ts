/**
 * `@farm.js/core/desktop`: the hook file contract (`src/desktop.ts`) and the interface desktop
 * shell adapters implement. Types and an identity helper only; nothing here runs in a web build.
 */
import type { ResolvedFarmDesktopConfig } from "./config";

export type {
  FarmDesktopUserConfig,
  FarmDesktopWindowConfig,
  ResolvedFarmDesktopConfig,
} from "./config";

/** The running Farm server, as the shell sees it. */
export interface DesktopServerInfo {
  origin: string;
  port: number;
}

/** Context passed to `onReady` in `src/desktop.ts`. */
export interface DesktopReadyContext<Window = unknown> {
  /** The shell's window object (an Electrobun `BrowserWindow`, for example). */
  window: Window;
  server: DesktopServerInfo;
  /** `"development"` under `farm dev --desktop`, otherwise `"production"`. */
  mode: "development" | "production";
}

export interface DesktopHooks<Window = unknown> {
  /** Runs in the shell process after the window opened on the app. */
  onReady?(context: DesktopReadyContext<Window>): void | Promise<void>;
}

/** Typed helper for `src/desktop.ts`. Hooks run in the shell process, never in the browser. */
export function defineDesktop<Window = unknown>(hooks: DesktopHooks<Window>): DesktopHooks<Window> {
  return hooks;
}

/** A file a shell adapter generates, relative to the shell output directory. */
export interface DesktopGeneratedFile {
  path: string;
  contents: string;
}

export interface DesktopShellContext {
  /** App root. */
  root: string;
  desktop: ResolvedFarmDesktopConfig;
  /** The app's basePath ("" or "/base"). */
  basePath: string;
  /** Directory the generated shell files are written to (`.farm/output/desktop/shell`). */
  shellDir: string;
  /** Farm server output (`.farm/output/desktop/server`); its entry exports `start()`. */
  serverDir: string;
  /** Absolute path of `src/desktop.ts` (or .js, .mts), when the app has one. */
  hooksFile?: string;
}

export interface DesktopDevContext extends DesktopShellContext {
  /** Origin of the running `farm dev` server, such as `http://localhost:3000`. */
  devUrl: string;
  /** Session secret the dev server's guard expects as the cookie. */
  secret: string;
  /** One-time token for the handshake URL. */
  handshakeToken: string;
  /** Data directory for `appDataDir()` in this dev session. */
  dataDir: string;
  /** Environment for the shell process (already includes the values above). */
  env: NodeJS.ProcessEnv;
}

export interface DesktopPackageContext extends DesktopShellContext {
  /** Directory for packaged apps and installers (`.farm/output/desktop/dist`). */
  distDir: string;
}

export interface DesktopArtifacts {
  /** Absolute paths of the produced apps, installers, and update archives. */
  files: string[];
}

/** A running shell started by `dev()`. */
export interface DesktopDevSession {
  /** Resolves when the shell exits by itself (the user closed the app). */
  exited: Promise<number>;
  close(): Promise<void>;
}

/** What a desktop shell package (such as `@farm.js/desktop-electrobun`) default-exports. */
export interface DesktopShell {
  name: string;
  /** The runtime the shell embeds the Farm server in; selects the `bun` or `node-server` preset. */
  runtime: "bun" | "node";
  /** Shell main process and config, written into `shellDir`. */
  generateMain(context: DesktopShellContext): DesktopGeneratedFile[] | Promise<DesktopGeneratedFile[]>;
  /** Start the shell with its window on `farm dev`. */
  dev(context: DesktopDevContext): Promise<DesktopDevSession>;
  /** Package the generated shell and server into an app. */
  package(context: DesktopPackageContext): Promise<DesktopArtifacts>;
}

/** Typed helper for shell adapter packages. */
export function defineDesktopShell(shell: DesktopShell): DesktopShell {
  return shell;
}
