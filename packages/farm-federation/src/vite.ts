import { federation as viteFederation } from "@module-federation/vite";
import type { ResolvedFederationOptions } from "./config.js";

interface ViteConfigLike {
  build?: {
    ssr?: unknown;
    rollupOptions?: {
      output?: FederationOutputOptions | FederationOutputOptions[];
    };
    rolldownOptions?: {
      output?: FederationOutputOptions | FederationOutputOptions[];
    };
  };
}

interface FederationOutputOptions {
  codeSplitting?: {
    groups?: Array<Record<string, unknown>>;
  };
  [key: string]: unknown;
}

interface ViteEnvironmentLike {
  command: string;
}

interface VitePluginLike {
  name?: string;
  apply?:
    | string
    | ((config: ViteConfigLike, environment: ViteEnvironmentLike) => boolean | undefined);
  resolveId?: unknown;
  load?: unknown;
  transform?: unknown;
  [key: string]: unknown;
}

type VitePluginOption =
  | VitePluginLike
  | false
  | null
  | undefined
  | Promise<VitePluginOption>
  | VitePluginOption[];

type HookFunction = (this: unknown, ...args: any[]) => unknown;

const SERVER_RUNTIME_ID = "\0farm:federation:server-runtime";

export function createFarmFederationVitePlugins(
  options: ResolvedFederationOptions,
  factory: (options: ResolvedFederationOptions["upstream"]) => VitePluginOption[] = viteFederation,
): VitePluginOption[] {
  const upstream = factory(options.upstream).map(restrictPluginOptionToClient);
  return [
    serverImportGuard(options.remoteAliases),
    isolateFarmExposes(),
    ...upstream,
    repairFarmManifest(),
  ];
}

export function restrictPluginOptionToClient(option: VitePluginOption): VitePluginOption {
  if (option instanceof Promise) {
    return option.then(restrictPluginOptionToClient);
  }
  if (Array.isArray(option)) {
    return option.map(restrictPluginOptionToClient);
  }
  if (!option || typeof option !== "object") return option;
  return restrictPluginToClient(option);
}

function isolateFarmExposes(): VitePluginLike {
  return {
    name: "farm:federation:output-boundary",
    apply: "build",
    enforce: "post",
    config(config: ViteConfigLike) {
      if (config.build?.ssr) return;
      for (const output of [
        config.build?.rollupOptions?.output,
        config.build?.rolldownOptions?.output,
      ]) {
        for (const candidate of Array.isArray(output) ? output : output ? [output] : []) {
          const codeSplitting = (candidate.codeSplitting ??= {});
          const groups = (codeSplitting.groups ??= []);
          if (groups.some((group) => group.name === "federation-exposes")) continue;
          groups.push({
            name: "federation-exposes",
            test: /virtual:mf-exposes:/,
            priority: 999_999,
          });
        }
      }
    },
  };
}

export function restrictPluginToClient(plugin: VitePluginLike): VitePluginLike {
  const originalApply = plugin.apply;
  const wrapped: VitePluginLike = {
    ...plugin,
    apply(config, environment) {
      if (config.build?.ssr) return false;
      // Farm uses a short-lived Vite serve environment for production route discovery.
      // Treat it as part of the build so upstream development workers do not outlive the CLI.
      if (environment.command === "serve" && process.env.NODE_ENV === "production") return false;
      if (typeof originalApply === "function") {
        return originalApply.call(this, config, environment);
      }
      return originalApply === undefined || originalApply === environment.command;
    },
  };

  wrapped.resolveId = wrapEnvironmentHook(plugin.resolveId, 2);
  wrapped.load = wrapEnvironmentHook(plugin.load, 1);
  wrapped.transform = wrapEnvironmentHook(plugin.transform, 2);
  return wrapped;
}

function serverImportGuard(remoteAliases: string[]): VitePluginLike {
  return {
    name: "farm:federation:server-import-guard",
    enforce: "pre",
    resolveId(
      this: { environment?: { name?: string }; error?: (message: string) => never },
      id: string,
      _importer: string | undefined,
      options?: { ssr?: boolean },
    ) {
      if (!isServerEnvironment(this, options)) return null;
      if (id === "@module-federation/runtime") return SERVER_RUNTIME_ID;
      if (!matchesRemote(id, remoteAliases)) return null;
      const message =
        `[farm:federation] Remote module ${JSON.stringify(id)} entered Farm's server graph. ` +
        "The current release federates browser modules only. Load it after hydration with " +
        "@farm.js/federation/client. Server federation is tracked at " +
        "https://github.com/farming-labs/farm.js/issues/885";
      if (this.error) return this.error(message);
      throw new Error(message);
    },
    load(id: string) {
      if (id !== SERVER_RUNTIME_ID) return null;
      return `
const serverError = () => {
  throw new Error("[farm:federation] Remote browser modules must be loaded after hydration with @farm.js/federation/client.");
};
export const loadRemote = serverError;
export const preloadRemote = serverError;
`;
    },
  };
}

function repairFarmManifest(): VitePluginLike {
  return {
    name: "farm:federation:manifest",
    apply: "build",
    enforce: "post",
    generateBundle(_output: unknown, bundle: Record<string, unknown>) {
      const remoteEntry = Object.values(bundle).find((output) => {
        if (!output || typeof output !== "object") return false;
        const chunk = output as { type?: unknown; facadeModuleId?: unknown };
        return (
          chunk.type === "chunk" &&
          typeof chunk.facadeModuleId === "string" &&
          chunk.facadeModuleId.includes("mf-REMOTE_ENTRY_ID")
        );
      }) as { fileName?: unknown } | undefined;
      if (!remoteEntry || typeof remoteEntry.fileName !== "string") return;

      for (const output of Object.values(bundle)) {
        if (!output || typeof output !== "object") continue;
        const asset = output as { fileName?: unknown; source?: unknown; type?: unknown };
        if (
          asset.type !== "asset" ||
          typeof asset.fileName !== "string" ||
          !/(?:^|\/)(?:mf-manifest|mf-stats)\.json$/.test(asset.fileName)
        ) {
          continue;
        }
        const source = typeof asset.source === "string" ? asset.source : asset.source?.toString();
        if (!source) continue;
        const document = JSON.parse(source) as {
          metaData?: { remoteEntry?: { name?: string } };
        };
        if (!document.metaData?.remoteEntry || document.metaData.remoteEntry.name) continue;
        document.metaData.remoteEntry.name = remoteEntry.fileName;
        asset.source = JSON.stringify(document);
      }
    },
  };
}

function wrapEnvironmentHook(hook: unknown, optionsIndex: number): unknown {
  if (typeof hook === "function") {
    return function (this: unknown, ...args: any[]) {
      if (isServerEnvironment(this, args[optionsIndex])) return null;
      return (hook as HookFunction).apply(this, args);
    };
  }
  if (
    hook &&
    typeof hook === "object" &&
    typeof (hook as { handler?: unknown }).handler === "function"
  ) {
    const hookObject = hook as Record<string, unknown> & { handler: HookFunction };
    return {
      ...hookObject,
      handler(this: unknown, ...args: any[]) {
        if (isServerEnvironment(this, args[optionsIndex])) return null;
        return hookObject.handler.apply(this, args);
      },
    };
  }
  return hook;
}

function isServerEnvironment(context: unknown, options: unknown): boolean {
  const environmentName = (context as { environment?: { name?: unknown } })?.environment?.name;
  return (
    environmentName === "ssr" ||
    environmentName === "server" ||
    Boolean((options as { ssr?: unknown } | undefined)?.ssr)
  );
}

function matchesRemote(id: unknown, aliases: string[]): boolean {
  return (
    typeof id === "string" && aliases.some((alias) => id === alias || id.startsWith(`${alias}/`))
  );
}
