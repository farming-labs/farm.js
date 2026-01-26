import type { FarmConfig, FarmRequest, FarmResponse } from "./types";
import type { ViteDevServer } from "vite";

export interface FarmPluginContext {
  config: FarmConfig;
  viteServer?: ViteDevServer;
  isDev: boolean;
  isProd: boolean;
}

export interface FarmPlugin {
  name: string;
  version?: string;
  enforce?: "pre" | "post";

  config?: (config: FarmConfig, context: FarmPluginContext) => FarmConfig | Promise<FarmConfig>;
  configResolved?: (config: FarmConfig, context: FarmPluginContext) => void | Promise<void>;
  buildStart?: (context: FarmPluginContext) => void | Promise<void>;
  buildEnd?: (context: FarmPluginContext) => void | Promise<void>;

  beforeRequest?: (
    req: FarmRequest,
    res: FarmResponse,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  afterResponse?: (
    req: FarmRequest,
    res: FarmResponse,
    context: FarmPluginContext,
  ) => void | Promise<void>;

  // Transform hooks
  transformHTML?: (html: string, context: FarmPluginContext) => string | Promise<string>;
  transformPage?: (component: any, context: FarmPluginContext) => any | Promise<any>;
}

export class PluginManager {
  private plugins: FarmPlugin[] = [];
  private context: FarmPluginContext;

  constructor(context: FarmPluginContext) {
    this.context = context;
  }

  addPlugin(plugin: FarmPlugin) {
    this.plugins.push(plugin);
  }

  addPlugins(plugins: FarmPlugin[]) {
    for (const plugin of plugins) {
      this.addPlugin(plugin);
    }
  }

  getPlugins(): FarmPlugin[] {
    return [...this.plugins];
  }

  getSortedPlugins(): FarmPlugin[] {
    const pre = this.plugins.filter((p) => p.enforce === "pre");
    const normal = this.plugins.filter((p) => !p.enforce);
    const post = this.plugins.filter((p) => p.enforce === "post");
    return [...pre, ...normal, ...post];
  }

  async runHook<K extends keyof FarmPlugin>(hookName: K, ...args: any[]): Promise<any> {
    const plugins = this.getSortedPlugins();

    for (const plugin of plugins) {
      const hook = plugin[hookName];
      if (typeof hook === "function") {
        const result = await (hook as any).apply(plugin, [...args, this.context]);
        if (result !== undefined) {
          return result;
        }
      }
    }
  }

  async runHookSerial<K extends keyof FarmPlugin>(
    hookName: K,
    initialValue: any,
    ...args: any[]
  ): Promise<any> {
    const plugins = this.getSortedPlugins();
    let value = initialValue;

    for (const plugin of plugins) {
      const hook = plugin[hookName];
      if (typeof hook === "function") {
        const result = await (hook as any).apply(plugin, [value, ...args, this.context]);
        if (result !== undefined) {
          value = result;
        }
      }
    }

    return value;
  }

  async runHookParallel<K extends keyof FarmPlugin>(hookName: K, ...args: any[]): Promise<boolean> {
    const plugins = this.getSortedPlugins();

    // Run plugins sequentially for request hooks to allow early termination
    if (hookName === "beforeRequest" || hookName === "afterResponse") {
      for (const plugin of plugins) {
        const hook = plugin[hookName];
        if (typeof hook === "function") {
          // Check if response is already sent (only for beforeRequest)
          if (hookName === "beforeRequest") {
            const res = args[1];
            if (res && res.writableEnded) {
              return true;
            }
          }

          await (hook as any).apply(plugin, [...args, this.context]);

          // Check again after plugin execution (only for beforeRequest)
          if (hookName === "beforeRequest") {
            const res = args[1];
            if (res && res.writableEnded) {
              return true;
            }
          }
        }
      }
    } else {
      // Run other hooks in parallel
      const promises: Promise<any>[] = [];
      for (const plugin of plugins) {
        const hook = plugin[hookName];
        if (typeof hook === "function") {
          promises.push((hook as any).apply(plugin, [...args, this.context]));
        }
      }
      await Promise.all(promises);
    }

    return false;
  }

  updateContext(updates: Partial<FarmPluginContext>) {
    this.context = { ...this.context, ...updates };
  }
}

export function definePlugin(plugin: FarmPlugin): FarmPlugin {
  return plugin;
}
