import { resolveFarmAppClientEntry, resolveFarmClientPlugins } from "./client-plugin-build";
import type { FarmPlugin } from "./plugin";
import { resolveFarmServerComponentsMode } from "./server-components-mode";
import type { FarmConfig } from "./types";

interface FarmIslandsClientBootConfig {
  experimental?: FarmConfig["experimental"];
  docs?: unknown;
  plugins?: readonly FarmPlugin[];
  root?: string;
  srcDir?: string;
}

/**
 * Whether islands documents that hydrate nothing at load can start with the boot entry instead of
 * the client runtime (RFC 0003, section 10), in `farm dev` and production alike. Client plugins,
 * an app client entry and the docs runtime run as the page loads, so an app with any of them loads
 * the runtime on every page.
 */
export function canBootFarmIslandsClient(config: FarmIslandsClientBootConfig): boolean {
  const docs = config.docs;
  const docsEnabled =
    docs === true ||
    (typeof docs === "object" &&
      docs !== null &&
      (docs as { enabled?: boolean }).enabled !== false);
  return (
    resolveFarmServerComponentsMode(config.experimental?.serverComponents) === "islands" &&
    !docsEnabled &&
    resolveFarmClientPlugins(config.plugins, config.root).length === 0 &&
    !resolveFarmAppClientEntry(config.root, config.srcDir || "src")
  );
}
