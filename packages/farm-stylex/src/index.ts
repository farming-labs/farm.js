import { definePlugin } from "@farm.js/core/plugin";
import stylexUnplugin, { type UserOptions } from "@stylexjs/unplugin";
import { resolveStylexOptions, type StyleXOptions } from "./config.js";
import { injectStylexDevelopmentAssets } from "./html.js";

export type { StyleXOptions };

/** Compile StyleX and connect its extracted CSS to Farm development and production builds. */
export function stylex(options: StyleXOptions = {}) {
  const resolved = resolveStylexOptions(options);
  let development = false;

  return definePlugin({
    name: "farm:stylex",
    enforce: "pre",

    configure(config, context) {
      if (
        (config.plugins ?? []).filter((candidate) => candidate.name === "farm:stylex").length > 1
      ) {
        throw new Error("[farm:stylex] Configure StyleX in one stylex() plugin instance");
      }

      development = context.isDev;
      // @stylexjs/unplugin documents and implements externalPackages, but its
      // 0.19.0 UserOptions declaration does not include the property yet.
      const compilerOptions: Partial<UserOptions> & { externalPackages: string[] } = {
        ...resolved,
        externalPackages: [...resolved.externalPackages],
        dev: context.isDev,
        devMode: context.isDev ? "full" : "off",
      };
      const vitePlugin = createStylexVitePlugin(compilerOptions, context.isDev);

      return {
        ...config,
        vite: {
          ...config.vite,
          plugins: [vitePlugin, ...(config.vite?.plugins ?? [])],
        },
      };
    },

    render: {
      html(html) {
        if (!development) return html;
        return injectStylexDevelopmentAssets(html);
      },
    },
  });
}

function createStylexVitePlugin(
  options: Partial<UserOptions> & { externalPackages: string[] },
  development: boolean,
): unknown {
  const plugins = stylexUnplugin.vite(options);
  if (development) return plugins;

  const keepProductionTransforms = (plugin: Record<string, unknown>) => ({
    ...plugin,
    // Farm evaluates routes through an internal Vite server during builds.
    // Keep compiler transforms active there without starting StyleX's dev
    // middleware, HMR interval, or HTML injection hooks.
    apply: () => true,
    configureServer: undefined,
    handleHotUpdate: undefined,
    transformIndexHtml: undefined,
  });

  return Array.isArray(plugins)
    ? plugins.map((plugin) => keepProductionTransforms(plugin as Record<string, unknown>))
    : keepProductionTransforms(plugins as Record<string, unknown>);
}
