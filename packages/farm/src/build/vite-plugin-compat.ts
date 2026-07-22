import type { FarmProductionViteBuilder } from "./production-vite";

type VitePluginLike = {
  name?: string;
  transform?: unknown;
};

type VitePluginHook = (...args: any[]) => any;

/**
 * Tailwind 4.1 supports Farm's Node 18 baseline, but its Vite plugin resolves
 * against Farm's Vite 5 compatibility dependency. When that plugin runs in
 * Vite 8 it mistakes the active environment for its own Vite environment and
 * calls an API that Vite 5 does not export. Keep its documented Vite 5 hook
 * path while Farm uses the Rolldown production builder.
 */
export function adaptTailwindVitePlugin<T>(pluginOption: T, builder: FarmProductionViteBuilder): T {
  if (builder !== "rolldown") return pluginOption;
  return adaptPluginOption(pluginOption) as T;
}

function adaptPluginOption(pluginOption: unknown): unknown {
  if (Array.isArray(pluginOption)) return pluginOption.map(adaptPluginOption);
  if (!pluginOption || typeof pluginOption !== "object") return pluginOption;

  const plugin = pluginOption as VitePluginLike;
  if (!plugin.name?.startsWith("@tailwindcss/vite:generate:")) return pluginOption;

  if (isVitePluginHook(plugin.transform)) {
    return {
      ...plugin,
      transform: withVite5TransformContext(plugin.transform),
    };
  }

  if (
    plugin.transform &&
    typeof plugin.transform === "object" &&
    "handler" in plugin.transform &&
    isVitePluginHook(plugin.transform.handler)
  ) {
    return {
      ...plugin,
      transform: {
        ...plugin.transform,
        handler: withVite5TransformContext(plugin.transform.handler),
      },
    };
  }

  return pluginOption;
}

function isVitePluginHook(value: unknown): value is VitePluginHook {
  return typeof value === "function";
}

function withVite5TransformContext<T extends (...args: any[]) => any>(handler: T): T {
  return function (this: object, ...args: Parameters<T>): ReturnType<T> {
    const context = new Proxy(this, {
      get(target, property, receiver) {
        if (property === "environment") return undefined;
        return Reflect.get(target, property, receiver);
      },
    });
    return handler.apply(context, args);
  } as T;
}
