import { definePlugin } from "@farm.js/core/plugin";
import { isFarmRendererDisabled } from "@farm.js/core/renderer";

export type { FarmWebMCPRuntime } from "./types.js";
export type { WebMCPUnsupportedBehavior } from "./client.js";

export interface WebMCPPluginOptions {
  /** Behavior when `document.modelContext` is unavailable. Defaults to warn in development. */
  unsupported?: "ignore" | "warn" | "error";
  /** Expose `window.__FARM_WEBMCP__` for inspection. Defaults to true in development. */
  debug?: boolean;
  /**
   * Report each tool call to the app's server, which sends it to Farm Infra analytics when
   * the server is linked (`FARMJS_API_KEY`). Defaults to true. `false` sends nothing.
   */
  analytics?: boolean;
}

/** Where the browser reports tool calls, below the base path. Core's `FARM_WEBMCP_REPORT_PATH`. */
const REPORT_PATH = "/_farm/webmcp/tool-calls";

/** Register Farm's explicit browser tools with the experimental WebMCP API. */
export function webmcp(options: WebMCPPluginOptions = {}) {
  assertOptions(options);
  const publicConfig: {
    unsupported: WebMCPPluginOptions["unsupported"] | null;
    debug: boolean | null;
    analytics: boolean;
    report: string | null;
  } = {
    unsupported: options.unsupported ?? null,
    debug: options.debug ?? null,
    analytics: options.analytics ?? true,
    report: options.analytics === false ? null : REPORT_PATH,
  };

  return definePlugin({
    name: "farm:webmcp",
    configure(config) {
      // A backend-only app loads no page to register tools from.
      if (isFarmRendererDisabled(config.renderer)) {
        throw new Error(
          "[farm:webmcp] WebMCP registers tools from rendered pages, but this app sets `renderer: false` and has no pages. " +
            "Remove webmcp(), or remove `renderer: false` to render pages.",
        );
      }
      if (publicConfig.report) publicConfig.report = withBasePath(REPORT_PATH, config.basePath);
    },
    client: {
      public: publicConfig,
      async setup({ public: config, isDev }) {
        const runtime = await import("@farm.js/webmcp/client");
        return runtime.startWebMCPRuntime({
          unsupported: config.unsupported ?? (isDev ? "warn" : "ignore"),
          debug: config.debug ?? isDev,
          ...(config.report ? { report: config.report } : {}),
        });
      },
      navigation: {
        async rendered({ state }) {
          await state?.sync();
        },
      },
      close({ state }) {
        state?.close();
      },
    },
  });
}

function assertOptions(options: WebMCPPluginOptions): void {
  if ("enabled" in options) {
    throw new TypeError(
      "webmcp no longer accepts enabled; remove webmcp() from plugins to disable it",
    );
  }
  if (options.debug !== undefined && typeof options.debug !== "boolean") {
    throw new TypeError("webmcp debug must be boolean");
  }
  if (options.analytics !== undefined && typeof options.analytics !== "boolean") {
    throw new TypeError(
      "webmcp analytics must be boolean; pass `analytics: false` to stop reporting tool calls",
    );
  }
  if (
    options.unsupported !== undefined &&
    options.unsupported !== "ignore" &&
    options.unsupported !== "warn" &&
    options.unsupported !== "error"
  ) {
    throw new TypeError('webmcp unsupported must be "ignore", "warn", or "error"');
  }
}

function withBasePath(path: string, basePath: string | undefined): string {
  const base = !basePath || basePath === "/" ? "" : `/${basePath.replace(/^\/+|\/+$/g, "")}`;
  return `${base}${path}`;
}
