export type FarmThemePreference = "light" | "dark" | "system";

export type FarmResolvedTheme = Exclude<FarmThemePreference, "system">;

export interface FarmThemeConfig {
  /** Initial preference when the visitor has not selected one. @default "system" */
  default?: FarmThemePreference;
  /** Cookie and cross-tab storage key. @default "farm-theme" */
  storageKey?: string;
}

export interface ResolvedFarmThemeConfig {
  enabled: boolean;
  default: FarmThemePreference;
  storageKey: string;
  cookiePath: string;
}

export interface FarmThemeSnapshot {
  /** Saved visitor preference. */
  theme: FarmThemePreference;
  /** Active browser color mode. Undefined during SSR when the preference is `system`. */
  resolvedTheme: FarmResolvedTheme | undefined;
  /** Whether the browser runtime has resolved the theme. */
  mounted: boolean;
}

export interface FarmThemeRuntime {
  config: ResolvedFarmThemeConfig;
  serverSnapshot: FarmThemeSnapshot;
  snapshot: FarmThemeSnapshot;
  setTheme(theme: FarmThemePreference): void;
}
