import type { IncomingMessage, ServerResponse } from "http";

export interface ObservabilityPluginOptions {
  slowRequestMs?: number;
  logLifecycle?: boolean;
}

interface ObservabilityPlugin {
  name: string;
  enforce?: "pre" | "post";
  init?: () => void;
  ready?: () => void;
  beforeRequest?: (req: IncomingMessage, res: ServerResponse) => void;
  afterResponse?: (req: IncomingMessage, res: ServerResponse) => void;
  afterApiHandler?: (response: Response, api: { method: string; pathname: string }) => Response;
  afterRender?: (html: string, render: { pathname: string; routePattern: string | null }) => string;
  onError?: (error: { phase: string; error: unknown }) => void;
  hmrUpdate?: (update: { file: string; modules: string[] }) => void;
  afterBundle?: (result: { success: boolean; preset: string; root: string }) => void;
  afterNitroBuild?: (payload: { preset: string; outputDir: string }) => void;
  shutdown?: (payload: { reason: string }) => void;
}

export function observabilityPlugin(options: ObservabilityPluginOptions = {}): ObservabilityPlugin {
  const slowRequestMs = options.slowRequestMs ?? 300;
  const logLifecycle = options.logLifecycle ?? true;
  const activeRequests = new Map<string, number>();

  const now = () => Date.now();
  const keyFor = (method: string, path: string) => `${method}:${path}`;

  return {
    name: "@farmjs/plugin-observability",
    enforce: "post",

    init() {
      if (logLifecycle) console.log("[obs] init");
    },

    ready() {
      if (logLifecycle) console.log("[obs] ready");
    },

    beforeRequest(req) {
      const path = req.url || "/";
      const method = req.method || "GET";
      activeRequests.set(keyFor(method, path), now());
    },

    afterResponse(req, res) {
      const path = req.url || "/";
      const method = req.method || "GET";
      const key = keyFor(method, path);
      const started = activeRequests.get(key);
      if (!started) return;
      activeRequests.delete(key);

      const duration = now() - started;
      if (duration >= slowRequestMs) {
        console.warn(
          `[obs] slow request ${method} ${path} status=${res.statusCode || 200} duration=${duration}ms`,
        );
      }
    },

    afterApiHandler(response, api) {
      const status = response.status;
      if (status >= 500) {
        console.error(`[obs] api error ${api.method} ${api.pathname} status=${status}`);
      }
      return response;
    },

    afterRender(html, render) {
      const marker = `<!-- observability:path=${render.pathname} route=${render.routePattern ?? "unmatched"} -->`;
      return html.includes("</body>")
        ? html.replace("</body>", `${marker}\n</body>`)
        : `${html}\n${marker}`;
    },

    onError(error) {
      const message = error.error instanceof Error ? error.error.message : String(error.error);
      console.error(`[obs] phase=${error.phase} error=${message}`);
    },

    hmrUpdate(update) {
      if (logLifecycle) {
        console.log(`[obs] hmr file=${update.file} modules=${update.modules.length}`);
      }
    },

    afterBundle(result) {
      const state = result.success ? "success" : "failed";
      console.log(`[obs] bundle ${state} preset=${result.preset} root=${result.root}`);
    },

    afterNitroBuild(payload) {
      console.log(`[obs] nitro preset=${payload.preset} output=${payload.outputDir}`);
    },

    shutdown(payload) {
      if (logLifecycle) console.log(`[obs] shutdown reason=${payload.reason}`);
      activeRequests.clear();
    },
  };
}
