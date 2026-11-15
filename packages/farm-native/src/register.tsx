/**
 * `@farm.js/native/register`: what Farm's generated native entry calls. Registers each screen
 * under its manifest module id (such as `app/notes/[id]`) and wraps it so a screen that fails to
 * load or render hands its route back to the shell, which shows the web twin instead.
 */
import { Component, useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { AppRegistry } from "react-native";
import { serverFetch } from "./index";
import { describeError, loadFarmScreen } from "./load";
import { matchFarmRoute } from "./routes";
import {
  farmApp,
  FarmScreenContext,
  farmShell,
  type FarmScreenProps,
  type FarmScreenState,
} from "./runtime";

/** A `page.native.tsx` module. `metadata.title` becomes the native bar's title. */
export interface FarmNativeScreenModule {
  default?: ComponentType<Record<string, never>>;
  metadata?: { title?: unknown };
}

export interface FarmNativeScreenEntry {
  route: string;
  /** Loads the screen's module on first open, so unopened screens cost no startup work. */
  load: () => FarmNativeScreenModule;
}

export interface FarmNativeRegistration {
  basePath: string;
  locales?: readonly string[];
  /** Keyed by module id. */
  screens: Record<string, FarmNativeScreenEntry>;
}

class FallbackBoundary extends Component<
  { screen: number; module: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    const reason = `${this.props.module}: ${describeError(error)}`;
    const shell = farmShell();
    if (shell) shell.fallback(this.props.screen, reason);
    else console.error(`Farm native screen failed and no shell can show its web twin: ${reason}`);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function Screen({
  module,
  entry,
  screen,
}: {
  module: string;
  entry: FarmNativeScreenEntry;
  screen: number;
}) {
  // Throws inside the boundary, naming the module and its error, when the module fails to evaluate.
  const loaded = loadFarmScreen(module, entry.load);
  const ScreenComponent = loaded.default;
  if (typeof ScreenComponent !== "function" && typeof ScreenComponent !== "object") {
    throw new TypeError(`${module} has no default export to render.`);
  }
  const title = typeof loaded.metadata?.title === "string" ? loaded.metadata.title : undefined;
  useEffect(() => {
    if (title) farmShell()?.setTitle(screen, title);
  }, [screen, title]);
  useEffect(() => farmShell()?.rendered(screen), [screen]);
  return <ScreenComponent />;
}

/** Register every native screen of the app with React Native's `AppRegistry`. */
// `@farm.js/core/api/client` on a native screen sends the app's API calls through `serverFetch`,
// which it reads here, so core needs no dependency on this package.
(globalThis as Record<symbol, unknown>)[Symbol.for("farm.native.serverFetch")] = serverFetch;

export function registerFarmScreens(registration: FarmNativeRegistration): void {
  farmApp.basePath = registration.basePath === "/" ? "" : registration.basePath;
  for (const [module, entry] of Object.entries(registration.screens)) {
    function FarmScreenRoot(props: FarmScreenProps) {
      farmApp.server ||= props.server;
      const state = useMemo<FarmScreenState>(() => {
        const pathname = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(props.url)?.[1] || "/";
        const params = matchFarmRoute(entry.route, pathname, {
          basePath: farmApp.basePath,
          locales: registration.locales,
        });
        return { ...props, basePath: farmApp.basePath, params: params ?? {} };
      }, [props]);
      return (
        <FarmScreenContext.Provider value={state}>
          <FallbackBoundary screen={props.screen} module={module}>
            <Screen module={module} entry={entry} screen={props.screen} />
          </FallbackBoundary>
        </FarmScreenContext.Provider>
      );
    }
    FarmScreenRoot.displayName = `FarmScreen(${module})`;
    AppRegistry.registerComponent(module, () => FarmScreenRoot);
  }
}
