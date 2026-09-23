import { definePlugin } from "@farm.js/core/plugin";
import stylexUnplugin, { type UserOptions } from "@stylexjs/unplugin";
import { resolveStylexOptions, type StyleXOptions } from "./config.js";
import { injectStylexDevelopmentAssets, stripStylexDevelopmentBasePath } from "./html.js";

export type { StyleXOptions };

/** Compile StyleX and connect its extracted CSS to Farm development and production builds. */
export function stylex(options: StyleXOptions = {}) {
  const resolved = resolveStylexOptions(options);
  let development = false;
  let configuredBasePath = "/";

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
      configuredBasePath = readBasePath(config.basePath) ?? "/";
      // @stylexjs/unplugin documents and implements externalPackages, but its
      // 0.19.0 UserOptions declaration does not include the property yet.
      const compilerOptions: Partial<UserOptions> & { externalPackages: string[] } = {
        ...resolved,
        externalPackages: [...resolved.externalPackages],
        dev: context.isDev,
        devMode: context.isDev ? "full" : "off",
      };
      const vitePlugin = createStylexVitePlugin(compilerOptions, context.isDev);
      const basePathPlugin =
        context.isDev && hasBasePath(configuredBasePath)
          ? createStylexBasePathVitePlugin(configuredBasePath)
          : undefined;

      return {
        ...config,
        vite: {
          ...config.vite,
          plugins: [
            ...(basePathPlugin ? [basePathPlugin] : []),
            vitePlugin,
            ...(config.vite?.plugins ?? []),
          ],
        },
      };
    },

    render: {
      html(html, _render, context) {
        if (!development) return html;
        return injectStylexDevelopmentAssets(
          html,
          readBasePath(context.config.basePath) ?? configuredBasePath,
        );
      },
    },
  });
}

function readBasePath(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function hasBasePath(value: string): boolean {
  return value.replace(/^\/+|\/+$/g, "").length > 0;
}

function createStylexBasePathVitePlugin(basePath: string) {
  return {
    name: "farm:stylex-base-path",
    enforce: "pre" as const,
    configureServer(server: {
      middlewares: {
        use(
          middleware: (request: { url?: string }, response: unknown, next: () => void) => void,
        ): void;
      };
    }) {
      server.middlewares.use((request, _response, next) => {
        if (request.url) {
          request.url = stripStylexDevelopmentBasePath(request.url, basePath);
        }
        next();
      });
    },
  };
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
