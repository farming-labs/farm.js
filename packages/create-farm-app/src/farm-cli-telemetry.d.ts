declare module "@farm.js/cli/telemetry" {
  export function showFarmTelemetryNotice(): Promise<void>;

  export function trackFarmProjectCreated(input: {
    packageVersion: string;
    template?: string;
    renderer?: string;
    packageManager?: string;
    typescript?: boolean;
    installedDependencies?: boolean;
  }): Promise<void>;
}
