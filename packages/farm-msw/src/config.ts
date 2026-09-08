export type MswUnhandledRequestBehavior = "bypass" | "warn" | "error";

export interface MswPluginOptions {
  /** Module exporting a `handlers` array. Resolved from the Farm app root. */
  handlers: string;
  /** Mock requests made by browser code. Defaults to true. */
  browser?: boolean;
  /** Mock requests made during development SSR and by server code. Defaults to true. */
  server?: boolean;
  /** How MSW handles requests that have no matching handler. Defaults to bypass. */
  onUnhandledRequest?: MswUnhandledRequestBehavior;
  /** Set false to leave the plugin configured without starting either runtime. */
  enabled?: boolean;
}

export interface ResolvedMswOptions {
  handlers: string;
  browser: boolean;
  server: boolean;
  onUnhandledRequest: MswUnhandledRequestBehavior;
  enabled: boolean;
}

export function resolveMswOptions(options: MswPluginOptions): ResolvedMswOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("msw options must be an object");
  }
  if (typeof options.handlers !== "string" || !options.handlers.trim()) {
    throw new TypeError("msw handlers must be a non-empty module path");
  }
  assertBoolean(options.browser, "browser");
  assertBoolean(options.server, "server");
  assertBoolean(options.enabled, "enabled");

  if (
    options.onUnhandledRequest !== undefined &&
    options.onUnhandledRequest !== "bypass" &&
    options.onUnhandledRequest !== "warn" &&
    options.onUnhandledRequest !== "error"
  ) {
    throw new TypeError('msw onUnhandledRequest must be "bypass", "warn", or "error"');
  }

  return {
    handlers: options.handlers.trim(),
    browser: options.browser ?? true,
    server: options.server ?? true,
    onUnhandledRequest: options.onUnhandledRequest ?? "bypass",
    enabled: options.enabled ?? true,
  };
}

function assertBoolean(value: unknown, key: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`msw ${key} must be boolean`);
  }
}
