import type { Plugin } from "vite";
import { resolveFarmThemeConfig } from "./config";
import type { FarmThemeConfig, ResolvedFarmThemeConfig } from "./types";

const FARM_DARK_VARIANT =
  '@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));';

export function createFarmThemeCssPlugin(
  input: FarmThemeConfig | ResolvedFarmThemeConfig | false | undefined,
  basePath = "/",
): Plugin {
  const config = resolveFarmThemeConfig(input, basePath);

  return {
    name: "farm:theme-css",
    enforce: "pre",
    transform(code, id) {
      if (
        !config.enabled ||
        !/\.css(?:\?.*)?$/.test(id) ||
        !/@import\s+["']tailwindcss["']/.test(code) ||
        /@custom-variant\s+dark\b/.test(code)
      ) {
        return null;
      }

      return {
        code: `${code.trimEnd()}\n\n${FARM_DARK_VARIANT}\n`,
        map: null,
      };
    },
  };
}
