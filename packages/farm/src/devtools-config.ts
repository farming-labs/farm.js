export const DEFAULT_FARM_DEVTOOLS_SHORTCUT = "mod+shift+.";
export const FARM_DEVTOOLS_PATH = "/__farm/devtools";
export const FARM_DEVTOOLS_LAUNCH_PARAM = "__farm_devtools";

export interface FarmDevtoolsConfig {
  /** Enable the development-only DevTools UI and runtime endpoints. */
  enabled?: boolean;
  /** Keyboard shortcut used to toggle DevTools, or false to disable the shortcut. */
  shortcut?: string | false;
}

export type FarmDevtoolsUserConfig = boolean | FarmDevtoolsConfig;

export interface ResolvedFarmDevtoolsConfig {
  enabled: boolean;
  shortcut: string | false;
}

export function resolveFarmDevtoolsConfig(
  config: FarmDevtoolsUserConfig | ResolvedFarmDevtoolsConfig | undefined,
  mode: "development" | "production" = "development",
): ResolvedFarmDevtoolsConfig {
  if (mode !== "development" || config === false) {
    return { enabled: false, shortcut: false };
  }

  const options = config === true || config === undefined ? {} : config;
  const enabled = options.enabled ?? true;

  if (!enabled) {
    return { enabled: false, shortcut: false };
  }

  const shortcut =
    typeof options.shortcut === "string" && options.shortcut.trim()
      ? options.shortcut
          .toLowerCase()
          .split("+")
          .map((part) => part.trim())
          .filter(Boolean)
          .join("+")
      : options.shortcut === false
        ? false
        : DEFAULT_FARM_DEVTOOLS_SHORTCUT;

  return { enabled: true, shortcut };
}
