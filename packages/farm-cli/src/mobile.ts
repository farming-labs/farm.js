import path from "node:path";

export interface FarmMobileInspectOptions {
  root?: string;
  os?: "android" | "ios";
  profile?: string;
  command?: "dev" | "build";
}

/**
 * `farm config inspect --mobile`: the `mobile` block a dev session or build would use for an OS
 * and profile, and the `farm-routes.json` navigator manifest it produces. Writes nothing.
 */
export async function inspectFarmMobileConfig(options: FarmMobileInspectOptions = {}) {
  const root = path.resolve(options.root || process.cwd());
  const configRuntime = await import("@farm.js/core/internal/config-runtime");
  const { resolveFarmMobileApp } = await configRuntime.loadFarmMobileRuntime();
  const { context, mobile, manifest } = await resolveFarmMobileApp({
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
    routes: manifest,
  };
}
