import path from "node:path";
import type { Plugin, PluginOption } from "vite";
import { formatOptionalPeerInstallHint, isMissingPackageError } from "../optional-peer";
import { logger } from "../utils";
import type { FarmProductionViteBuilder } from "./production-vite";
import { adaptTailwindVitePlugin } from "./vite-plugin-compat";

type TailwindViteModule = { default: () => PluginOption };

const TAILWIND_CSS_IMPORT = /@import\s+["']tailwindcss["']/;

export const TAILWIND_VITE_INSTALL_HINT = formatOptionalPeerInstallHint(
  "@tailwindcss/vite",
  "enable built-in Tailwind CSS support",
  { dev: true },
);

let warnedMissingTailwind = false;

/**
 * Farm enables Tailwind out of the box when the app has no PostCSS config of
 * its own. `@tailwindcss/vite` is an optional peer: when it is not installed,
 * the app keeps building without Tailwind, and the first stylesheet that
 * imports `tailwindcss` logs how to enable it.
 */
export async function loadTailwindVitePlugin(
  options: { builder?: FarmProductionViteBuilder; announce?: boolean; label?: string } = {},
  importTailwind: () => Promise<TailwindViteModule> = () => import("@tailwindcss/vite"),
): Promise<PluginOption | undefined> {
  try {
    const tailwindVite = (await importTailwind()).default;
    const plugin = options.builder
      ? adaptTailwindVitePlugin(tailwindVite(), options.builder)
      : tailwindVite();
    if (options.announce) logger.info("📦 Enabled built-in Tailwind support (@tailwindcss/vite)");
    return plugin;
  } catch (error) {
    if (isMissingPackageError(error, "@tailwindcss/vite")) return createMissingTailwindPlugin();
    logger.warn(
      `Tailwind plugin auto-enable failed${options.label ? ` ${options.label}` : ""}; continuing without it: ${(error as Error).message}`,
    );
    return undefined;
  }
}

function createMissingTailwindPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: "farm:tailwind-missing",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    transform(code, id) {
      if (warnedMissingTailwind || !/\.css(?:\?.*)?$/.test(id) || !TAILWIND_CSS_IMPORT.test(code)) {
        return null;
      }
      warnedMissingTailwind = true;
      const file = path.relative(root, id.split("?", 1)[0]!).replace(/\\/g, "/");
      logger.warn(
        `${file} imports Tailwind CSS, but @tailwindcss/vite is not installed; continuing without Tailwind. ${TAILWIND_VITE_INSTALL_HINT}`,
      );
      return null;
    },
  };
}
