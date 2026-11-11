import type { FarmPlugin } from "@farm.js/core/plugin";
import type { BotWidgetStart } from "./client.js";
import { withBotCsp, type BotCspInput } from "./csp.js";
import { BotError } from "./errors.js";
import {
  assertBotProvider,
  botClientIssues,
  type BotClientState,
  type BotProvider,
  type BotProviderClient,
} from "./provider.js";
import { setBotVerifier, type BotVerifier } from "./runtime.js";
import { verifyBotCheck } from "./verify.js";

export { BotError, type BotErrorCode } from "./errors.js";
export { createBotKeys, type BotKeys, type BotKeysConfig, type BotProviderKeys } from "./keys.js";
export {
  BOT_FAILURE_CODES,
  defineBotProvider,
  type BotClientState,
  type BotCspSources,
  type BotFailureCode,
  type BotProvider,
  type BotProviderClient,
  type BotVerdict,
  type BotVerdictFail,
  type BotVerdictPass,
  type BotVerifyInput,
} from "./provider.js";
export type {
  BotCheckFailure,
  BotCheckResult,
  BotCheckSuccess,
  BotCheckVerifyOptions,
} from "./verify.js";

const PLUGIN_NAME = "farm:bot";
const MAX_TIMEOUT_MS = 2_147_483_647;
const WIDGET_MODULE = "@farm.js/bot/provider-widget";

interface ViteConfig {
  plugins?: unknown[];
  [option: string]: unknown;
}
type ViteConfigInput = ViteConfig | ((config: ViteConfig) => ViteConfig) | undefined;

interface VitePluginContext {
  resolve(id: string, importer: undefined, options: object): Promise<unknown>;
}

/** Point the plugin's fixed browser hook at the module this provider names. */
function widgetResolver(providerName: string, widget: string) {
  return {
    name: "farm:bot-widget",
    enforce: "pre" as const,
    async resolveId(
      this: VitePluginContext,
      id: string,
      _importer: unknown,
      options: { ssr?: boolean },
    ) {
      // Server bundles keep the package's empty module, so browser code never lands in them.
      if (id !== WIDGET_MODULE || options.ssr) return undefined;
      const resolved = await this.resolve(widget, undefined, { ...options, skipSelf: true });
      if (resolved) return resolved;
      throw new BotError(
        "invalid_provider",
        `Bot provider "${providerName}" names the widget "${widget}", which can't be found. Use a package path the app can import, or a path from the app root such as "/src/acme.widget.ts".`,
      );
    },
  };
}

function withVitePlugin(vite: ViteConfigInput, plugin: unknown): ViteConfigInput {
  const add = (config: ViteConfig | undefined): ViteConfig => ({
    ...config,
    plugins: [plugin, ...(config?.plugins ?? [])],
  });
  return typeof vite === "function" ? (config: ViteConfig) => add(vite(config)) : add(vite);
}

export interface BotOptions<TData = unknown> {
  /** The checker to use: one from `@farm.js/bot/captcha`, another package, or your own. */
  provider: BotProvider<TData>;
  /** Hostnames a check may come from. Defaults to the hostname of the request being verified. */
  hostnames?: readonly string[];
  /** How long to wait for the provider. Defaults to 5000. */
  timeoutMs?: number;
}

export type BotPlugin<TData = unknown> = FarmPlugin<
  unknown,
  Record<string, unknown>,
  BotClientState | void,
  unknown
> & {
  /**
   * Check a submission with this plugin. `verifyBot()` from `@farm.js/bot/server` does the same
   * without needing the plugin in hand. Call this one for a typed `check.data`.
   */
  verify: BotVerifier<TData>;
};

/** Protect forms with a bot checker. Add it to `plugins` in farm.config.ts. */
export function bot<TData = unknown>(options: BotOptions<TData>): BotPlugin<TData> {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(
      "bot() needs an options object with a `provider`. Use one from `@farm.js/bot/captcha`, or write your own with `defineBotProvider`.",
    );
  }
  const { provider, hostnames, timeoutMs = 5000 } = options;
  assertBotProvider(provider);

  const issues: string[] = [];
  if (
    hostnames !== undefined &&
    (!Array.isArray(hostnames) ||
      hostnames.length === 0 ||
      hostnames.some((hostname) => typeof hostname !== "string" || !hostname.trim()))
  ) {
    issues.push("`hostnames` must be a non-empty array of hostnames.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    issues.push(
      `\`timeoutMs\` must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}.`,
    );
  }
  if (issues.length > 0) {
    throw new TypeError(`bot() options are invalid. ${issues.join(" ")}`);
  }

  const verify: BotVerifier<TData> = (input, verifyOptions) =>
    verifyBotCheck({ provider, hostnames, timeoutMs }, input, verifyOptions);
  // How `verifyBot()` reaches these options from a route, which can't import farm.config.ts.
  setBotVerifier(verify as BotVerifier);

  // `farm start` loads the config too, without the build-only site key. Saving the error for
  // `configure` lets the server start, while `farm dev` and `farm build` still report it.
  let client: BotProviderClient | undefined;
  let clientError: unknown;
  try {
    client = provider.client?.();
    const clientProblems = provider.client ? botClientIssues(client) : [];
    if (clientProblems.length > 0) {
      client = undefined;
      throw new BotError(
        "invalid_provider",
        `Bot provider "${provider.name}" is invalid. ${clientProblems.join(" ")}`,
      );
    }
  } catch (error) {
    clientError = error;
  }

  const start: BotWidgetStart | undefined = client && {
    widget: client.widget,
    ...(provider.tokenField === undefined ? {} : { tokenField: provider.tokenField }),
    ...(client.public === undefined ? {} : { config: client.public }),
  };

  // A plain object: `definePlugin` would pull Farm's build tooling into the server bundle, and it
  // adds nothing for a plugin with no options schema.
  return {
    name: PLUGIN_NAME,
    verify,
    // Empty on purpose. Having it makes the server load farm.config.ts, so `bot()` runs there.
    // `setup`, `close`, or a request hook would send every prerendered page through the server.
    runtime: {},
    configure(appConfig) {
      if (clientError) throw clientError;
      const instances = (appConfig.plugins ?? []).filter(
        (candidate) => candidate?.name === PLUGIN_NAME,
      );
      if (instances.length > 1) {
        throw new Error(`[${PLUGIN_NAME}] Add the bot plugin once.`);
      }
      const csp = appConfig.security?.csp as BotCspInput;
      const addsCsp = csp !== undefined && csp !== false && provider.csp !== undefined;
      if (!client && !addsCsp) return;
      return {
        ...appConfig,
        ...(client
          ? { vite: withVitePlugin(appConfig.vite, widgetResolver(provider.name, client.widget)) }
          : {}),
        ...(addsCsp
          ? { security: { ...appConfig.security, csp: withBotCsp(csp, provider.csp!) as never } }
          : {}),
      };
    },
    ...(start
      ? {
          client: {
            public: start,
            // Farm compiles this from its source text, so it uses only its argument.
            async setup({ public: settings }: { public: BotWidgetStart }) {
              const [runtime, widget] = await Promise.all([
                import("@farm.js/bot/client"),
                import("@farm.js/bot/provider-widget"),
              ]);
              return runtime.startBotWidget(widget.default, settings);
            },
            close({ state }: { state: BotClientState | void }) {
              state?.close();
            },
          },
        }
      : {}),
  } as BotPlugin<TData>;
}
