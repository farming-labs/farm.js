import type { Plugin } from "vite";
import { resolveFarmPlatform } from "./config";

/**
 * `farm dev --desktop`: the desktop guard ahead of every other plugin's middleware, including
 * `enforce: "pre"` plugins, so the dev server answers only the desktop window.
 */
export function farmDesktopDevGuardPlugin(basePath: string | undefined): Plugin {
  return {
    name: "farm:desktop-dev-guard",
    enforce: "pre",
    apply: "serve",
    configureServer: {
      order: "pre",
      async handler(server) {
        if (resolveFarmPlatform() !== "desktop") return;
        const { createFarmDesktopDevGuard } = await import("./dev-guard");
        server.middlewares.use(createFarmDesktopDevGuard(server, { basePath: basePath || "" }));
      },
    },
  };
}
