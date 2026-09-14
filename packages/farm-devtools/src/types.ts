export interface DevtoolsOptions {
  /** Show the floating launcher. The keyboard shortcut remains available when false. */
  launcher?: boolean;
  /** Override the existing Farm DevTools shortcut. Set false to disable it. */
  shortcut?: string | false;
  /** Include the read-only browser module inspector. Defaults to true. */
  inspect?: boolean;
}

export interface InspectedModule {
  id: string;
  path: string;
  url: string;
}

export interface ModuleDetails extends InspectedModule {
  source: string;
  transformed: string;
  imports: string[];
  importers: string[];
}

export const DEVTOOLS_PATH = "/__farm/devtools";
