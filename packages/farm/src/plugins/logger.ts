import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { FarmResponse } from "../types";
import type { FarmRequest } from "../types";

export type FarmRequestLogFormat = "text" | "json";

export type FarmRequestLogLevel = "info" | "warn" | "error";

/** One completed request, as the logger plugin writes it. */
export interface FarmRequestLogEntry {
  time: string;
  level: FarmRequestLogLevel;
  method: string;
  /** Pathname and query string, with redacted query values masked. */
  path: string;
  status: number;
  durationMs: number;
  /** The request headers selected with the `headers` option, with redacted values masked. */
  headers?: Record<string, string>;
}

export interface LoggerPluginOptions {
  /**
   * Output format. Defaults to `"text"` (`GET /about 200 12ms`) in development and one JSON
   * object per line in production, which log collectors parse without a custom pattern.
   */
  format?: FarmRequestLogFormat;
  /**
   * Header and query-string names whose values are masked as `[redacted]`, matched case
   * insensitively. These add to the built-in list of credential names (`authorization`,
   * `cookie`, `set-cookie`, `proxy-authorization`, `x-api-key`, `api_key`, `apikey`,
   * `access_token`, `token`, `password`, `secret`), which always applies.
   */
  redact?: readonly string[];
  /**
   * Request headers to include in each entry. No header is logged unless it is listed here, and
   * a listed header that is also redacted logs `[redacted]`.
   */
  headers?: readonly string[];
  /**
   * Fraction of requests to log, from `0` to `1`. Defaults to `1`. Responses with a `5xx` status
   * are always logged, so sampling thins routine traffic without hiding failures.
   */
  sample?: number;
  /** @deprecated Use the request log, or `runtime.before` in a plugin of your own. */
  beforeRequest?: (
    req: FarmRequest,
    res: FarmResponse,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  /** @deprecated Use the request log, or `runtime.after` in a plugin of your own. */
  afterResponse?: (
    req: FarmRequest,
    res: FarmResponse,
    context: FarmPluginContext,
  ) => void | Promise<void>;
}

const REDACTED = "[redacted]";

const DEFAULT_REDACTED_NAMES = [
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "api_key",
  "apikey",
  "access_token",
  "token",
  "password",
  "secret",
];

function decodeQueryName(raw: string): string {
  const name = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function redactQuery(search: string, redacted: ReadonlySet<string>): string {
  if (search.length <= 1) return "";

  // Rewrite pair by pair rather than through URLSearchParams so repeated keys, ordering, and
  // the original encoding of everything that is not masked survive untouched.
  const pairs = search
    .slice(1)
    .split("&")
    .map((pair) => {
      const separator = pair.indexOf("=");
      const rawName = separator === -1 ? pair : pair.slice(0, separator);
      return redacted.has(decodeQueryName(rawName).toLowerCase()) ? `${rawName}=${REDACTED}` : pair;
    });
  return `?${pairs.join("&")}`;
}

function validateSample(sample: number | undefined): number {
  if (sample === undefined) return 1;
  if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0 || sample > 1) {
    throw new TypeError(
      `Farm logger plugin "sample" must be a number from 0 to 1, received ${String(sample)}`,
    );
  }
  return sample;
}

function levelForStatus(status: number): FarmRequestLogLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

function formatText(entry: FarmRequestLogEntry): string {
  const parts = [`${entry.method} ${entry.path} ${entry.status} ${entry.durationMs}ms`];
  for (const [name, value] of Object.entries(entry.headers ?? {})) {
    parts.push(`${name}=${JSON.stringify(value)}`);
  }
  return parts.join(" ");
}

function write(entry: FarmRequestLogEntry, format: FarmRequestLogFormat): void {
  const line = format === "json" ? JSON.stringify(entry) : formatText(entry);
  if (entry.level === "error") console.error(line);
  else console.log(line);
}

/**
 * Logs one line per request through the portable `runtime.after` hook, so it behaves the same
 * in development, Node production output, and edge runtimes. The callback options remain as
 * deprecated aliases for the Node-only flat hooks and run alongside the request log.
 */
export function createLoggerPlugin({
  format,
  redact = [],
  headers: loggedHeaders = [],
  sample,
  beforeRequest,
  afterResponse,
}: LoggerPluginOptions = {}): FarmPlugin {
  const sampleRate = validateSample(sample);
  const redactedNames = new Set(
    [...DEFAULT_REDACTED_NAMES, ...redact].map((name) => name.toLowerCase()),
  );
  const headerNames = loggedHeaders.map((name) => name.toLowerCase());

  const plugin: FarmPlugin = {
    name: "farm:logger",
    enforce: "post",

    runtime: {
      after({ request, response, durationMs, isProd }) {
        const status = response.status;
        if (status < 500 && sampleRate < 1 && Math.random() >= sampleRate) return;

        const url = new URL(request.url);
        const entry: FarmRequestLogEntry = {
          time: new Date().toISOString(),
          level: levelForStatus(status),
          method: request.method,
          path: `${url.pathname}${redactQuery(url.search, redactedNames)}`,
          status,
          durationMs,
        };

        const selected: Record<string, string> = {};
        for (const name of headerNames) {
          const value = request.headers.get(name);
          if (value !== null) selected[name] = redactedNames.has(name) ? REDACTED : value;
        }
        if (Object.keys(selected).length > 0) entry.headers = selected;

        write(entry, format ?? (isProd ? "json" : "text"));
      },
    },
  };

  if (beforeRequest) {
    plugin.beforeRequest = async (req, res, context) => {
      await beforeRequest(req, res, context);
    };
  }
  if (afterResponse) {
    plugin.afterResponse = async (req, res, context) => {
      await afterResponse(req, res, context);
    };
  }

  return plugin;
}
