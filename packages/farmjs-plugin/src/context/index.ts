import { randomUUID } from "crypto";

interface RequestLike {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface PluginContextLike {
  req: {
    set: (key: string, value: any, options?: { exposeToPage?: boolean }) => void;
    get: <T = any>(key: string) => T | undefined;
  };
}

interface ContextPluginLike {
  name: string;
  enforce?: "pre" | "post";
  beforeRequest?: (
    req: RequestLike,
    res: unknown,
    context: PluginContextLike,
  ) => void | Promise<void>;
  afterResponse?: (
    req: RequestLike,
    res: { statusCode?: number } | unknown,
    context: PluginContextLike,
  ) => void | Promise<void>;
}

export interface ContextPluginOptions {
  requestIdHeader?: string;
  localeHeader?: string;
  exposePathname?: boolean;
  beforeRequest?: (payload: { requestId: string; locale: string; pathname: string }) => void;
  afterResponse?: (payload: {
    requestId: string;
    locale: string;
    pathname: string;
    statusCode: number;
    durationMs: number;
  }) => void;
}

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

function getHeader(req: RequestLike, name: string): string | undefined {
  const direct = normalizeHeaderValue(req.headers[name.toLowerCase()]);
  if (direct) return direct;
  const fromRaw = normalizeHeaderValue((req.headers as any)[name]);
  return fromRaw;
}

/**
 * Demo plugin that exposes request context to server page props as `props.context`.
 *
 * @example
 * ```ts
 * import { contextPlugin } from "@farmjs/plugin/context";
 *
 * export default defineConfig({
 *   plugins: [contextPlugin()],
 * });
 * ```
 *
 * @example
 * ```tsx
 * export default function Page(props: any) {
 *   const requestId = props.context?.data.get("requestId");
 *   const locale = props.context?.data.get("locale");
 *   return <div>{requestId} - {locale}</div>;
 * }
 * ```
 */
export function contextPlugin(options: ContextPluginOptions = {}): ContextPluginLike {
  const requestIdHeader = (options.requestIdHeader || "x-request-id").toLowerCase();
  const localeHeader = (options.localeHeader || "x-locale").toLowerCase();
  const exposePathname = options.exposePathname ?? true;
  const beforeRequestCb = options.beforeRequest;
  const afterResponseCb = options.afterResponse;

  return {
    name: "@farmjs/plugin-context",
    enforce: "pre",
    beforeRequest(req, _res, context) {
      const pathname = req.url || "/";
      const requestId = getHeader(req, requestIdHeader) || randomUUID();
      const locale = getHeader(req, localeHeader) || "en";

      context.req.set("requestId", requestId, { exposeToPage: true });
      context.req.set("locale", locale, { exposeToPage: true });

      if (exposePathname) {
        context.req.set("pathname", pathname, { exposeToPage: true });
      }

      // Private value stays available only to plugin hooks.
      context.req.set("internal:requestStart", Date.now());
      if (beforeRequestCb) {
        beforeRequestCb({ requestId, locale, pathname });
      }
    },
    afterResponse(req, res, context) {
      if (!afterResponseCb) return;
      const requestId = context.req.get<string>("requestId") || "unknown";
      const locale = context.req.get<string>("locale") || "en";
      const started = context.req.get<number>("internal:requestStart");
      const pathname = req.url || "/";
      const durationMs = typeof started === "number" ? Date.now() - started : 0;
      const statusCode =
        typeof res === "object" && res !== null && "statusCode" in res
          ? Number((res as any).statusCode || 200)
          : 200;
      afterResponseCb({ requestId, locale, pathname, statusCode, durationMs });
    },
  };
}
