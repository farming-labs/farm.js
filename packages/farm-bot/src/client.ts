import { BotError } from "./errors.js";
import type { BotClientState } from "./provider.js";

export type { BotClientState } from "./provider.js";

export type BotTheme = "auto" | "light" | "dark";

/** What an app passes when it shows the check. */
export interface BotWidgetOptions {
  /** Defaults to `"auto"`, which follows the visitor's color scheme. */
  theme?: BotTheme;
  /** Passed straight to the provider's widget, for example `{ size: "compact" }`. */
  settings?: Readonly<Record<string, unknown>>;
  /** Called with the token once the visitor passes. A check that draws nothing passes `""`. */
  onVerify?: (token: string) => void;
  /** Called when the widget or its script fails. */
  onError?: (error: unknown) => void;
  /** Called when a token expires before the form is sent. */
  onExpire?: () => void;
}

export interface BotWidget {
  /** Clear the token and run the check again, for example after a failed submit. */
  reset(): void;
  /** Remove the widget. Safe to call before it has finished loading. */
  remove(): void;
}

/** The handle a component exposes through its ref. */
export type BotCheckHandle = Pick<BotWidget, "reset">;

/** What a provider's browser half receives for each widget. */
export interface BotWidgetMount {
  theme: BotTheme;
  settings: Readonly<Record<string, unknown>>;
  /** Aborted when the app removes the widget before `mount` has finished. */
  signal: AbortSignal;
  /** Report the token. Farm adds it to the form under the provider's `tokenField`. */
  onVerify(token: string): void;
  onError(error: unknown): void;
  /** Report that the token can no longer be used. Farm takes it out of the form. */
  onExpire(): void;
}

/** The browser half of a bot checker. */
export interface BotWidgetDriver {
  /** Draw the check inside `element`. `remove` must take away everything `mount` added. */
  mount(element: HTMLElement, mount: BotWidgetMount): BotWidget | Promise<BotWidget>;
}

/** Builds the browser half from the provider's `public` data. Return nothing to draw nothing. */
export type BotWidgetFactory<TConfig = undefined> = (
  config: TConfig,
) => BotWidgetDriver | void | Promise<BotWidgetDriver | void>;

/** Declare a provider's browser half. Make it the default export of the module `client()` names. */
export function defineBotWidget<TConfig = undefined>(
  create: BotWidgetFactory<TConfig>,
): BotWidgetFactory<TConfig> {
  return create;
}

/** What the plugin compiles into the browser bundle. */
export interface BotWidgetStart {
  widget: string;
  tokenField?: string;
  config?: unknown;
}

export interface BotScriptOptions {
  /** The browser global the script defines. */
  global: string;
  /** The script signals readiness through an `onload` callback instead of its load event. */
  readyCallback?: boolean;
}

interface Registry {
  driver: BotWidgetDriver | undefined;
  waiters: Array<(driver: BotWidgetDriver) => void>;
  scripts: Map<string, Promise<unknown>>;
  callbacks: number;
}

// Shared through the window: the plugin and the components may load separate module copies.
const REGISTRY = Symbol.for("farm.bot");
const MISSING_PROVIDER_WARNING_MS = 3000;

// Pages can gate a form on `onVerify`, so a check with nothing to show has to report in too.
const INVISIBLE_DRIVER: BotWidgetDriver = {
  mount(_element, mount) {
    const report = () => mount.onVerify("");
    report();
    return { reset: report, remove() {} };
  },
};

function registryFor(runtimeWindow: Window): Registry {
  const host = runtimeWindow as unknown as Record<symbol, Registry | undefined>;
  return (host[REGISTRY] ??= {
    driver: undefined,
    waiters: [],
    scripts: new Map(),
    callbacks: 0,
  });
}

/** Keep the widget's latest token in the form, so the form sends it like any other input. */
function withTokenField(driver: BotWidgetDriver, name: string | undefined): BotWidgetDriver {
  if (name === undefined) return driver;
  return {
    async mount(element, mount) {
      let field: HTMLInputElement | undefined;
      const clear = () => {
        field?.remove();
        field = undefined;
      };

      const widget = await driver.mount(element, {
        ...mount,
        onVerify(token) {
          if (mount.signal.aborted) return;
          // Vendor scripts add their own field, and a widget may redraw its element.
          const hasOwnField = [...element.querySelectorAll("[name]")].some(
            (node) => node !== field && node.getAttribute("name") === name,
          );
          if (!hasOwnField) {
            if (!field?.isConnected) {
              field = element.ownerDocument.createElement("input");
              field.type = "hidden";
              field.name = name;
              element.append(field);
            }
            field.value = token;
          }
          mount.onVerify(token);
        },
        onExpire() {
          clear();
          mount.onExpire();
        },
      });

      return {
        reset() {
          clear();
          widget.reset();
        },
        remove() {
          clear();
          widget.remove();
        },
      };
    },
  };
}

/** Start a provider's browser half. Farm calls this when the page loads. */
export async function startBotWidget(
  create: unknown,
  start: BotWidgetStart,
): Promise<BotClientState> {
  // The placeholder `@farm.js/bot/provider-widget` exports, in place of the provider's widget.
  if (create === Symbol.for("@farm.js/bot/no-widget")) {
    throw new BotError(
      "missing_plugin",
      `This build has no widget for "${start.widget}". The bot plugin's \`configure\` hook adds it, so add \`bot()\` to \`plugins\` in farm.config.ts. \`experimental.serverComponents\` in \`rsc\` mode skips that hook with \`@farm.js/core\` 0.1.67 or earlier.`,
    );
  }
  if (typeof create !== "function") {
    throw new TypeError(
      `"${start.widget}" must have \`defineBotWidget(...)\` as its default export.`,
    );
  }
  const driver = ((await create(start.config)) ?? INVISIBLE_DRIVER) as BotWidgetDriver;
  if (typeof driver.mount !== "function") {
    throw new TypeError(
      `The widget in "${start.widget}" must return an object with \`mount\`, or nothing if it draws nothing.`,
    );
  }
  return provideBotWidget(withTokenField(driver, start.tokenField));
}

/** Make a widget available to the page. Widgets mounted earlier wait for this. */
export function provideBotWidget(
  driver: BotWidgetDriver,
  runtimeWindow: Window = window,
): BotClientState {
  const registry = registryFor(runtimeWindow);
  registry.driver = driver;
  for (const resolve of registry.waiters.splice(0)) resolve(driver);
  return {
    close() {
      if (registry.driver === driver) registry.driver = undefined;
    },
  };
}

function waitForDriver(registry: Registry): Promise<BotWidgetDriver> {
  if (registry.driver) return Promise.resolve(registry.driver);
  return new Promise((resolve) => registry.waiters.push(resolve));
}

/** In development, say why a check never appears. The server still refuses the form. */
function warnIfNoProvider(registry: Registry, runtimeWindow: Window): () => void {
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (env?.DEV !== true || registry.driver) return () => {};
  const timer = runtimeWindow.setTimeout(() => {
    console.warn(
      "[farm:bot] No bot provider has started on this page. Add `bot({ provider })` to `plugins` in farm.config.ts. A provider with no browser half doesn't need a widget.",
    );
  }, MISSING_PROVIDER_WARNING_MS);
  return () => runtimeWindow.clearTimeout(timer);
}

/**
 * Show the bot check inside an element in a form. Pass a function to have callbacks read fresh
 * on every event, which is what the renderer components do.
 */
export function mountBotCheck(
  element: HTMLElement,
  options: BotWidgetOptions | (() => BotWidgetOptions) = {},
): BotWidget {
  const runtimeWindow = element.ownerDocument.defaultView;
  if (!runtimeWindow) {
    throw new Error("mountBotCheck() needs an element in a document with a window.");
  }

  const latest = typeof options === "function" ? options : () => options;
  const { theme = "auto", settings = {} } = latest();
  const aborter = new AbortController();
  let widget: BotWidget | undefined;

  const reportError = (error: unknown) => {
    if (aborter.signal.aborted) return;
    const { onError } = latest();
    if (onError) onError(error);
    else console.error("[farm:bot]", error);
  };

  const registry = registryFor(runtimeWindow);
  const stopWarning = warnIfNoProvider(registry, runtimeWindow);

  waitForDriver(registry)
    .then((driver) => {
      stopWarning();
      if (aborter.signal.aborted) return undefined;
      return driver.mount(element, {
        theme,
        settings,
        signal: aborter.signal,
        // A provider with no `remove` can still call back after the app removed the widget.
        onVerify: (token) => {
          if (!aborter.signal.aborted) latest().onVerify?.(token);
        },
        onError: reportError,
        onExpire: () => {
          if (!aborter.signal.aborted) latest().onExpire?.();
        },
      });
    })
    .then((mounted) => {
      if (!mounted) return;
      if (aborter.signal.aborted) mounted.remove();
      else widget = mounted;
    })
    .catch(reportError);

  return {
    reset() {
      widget?.reset();
    },
    remove() {
      aborter.abort();
      stopWarning();
      widget?.remove();
      widget = undefined;
    },
  };
}

/** Load a provider's script once per page, carrying the page's CSP nonce. */
export function loadBotScript<TApi = unknown>(
  src: string,
  options: BotScriptOptions,
  runtimeWindow: Window = window,
): Promise<TApi> {
  const registry = registryFor(runtimeWindow);
  const existing = registry.scripts.get(src);
  if (existing) return existing as Promise<TApi>;

  const host = runtimeWindow as unknown as Record<string, any>;
  const { global, readyCallback } = options;

  const loading = new Promise<TApi>((resolve, reject) => {
    const current = host[global];
    if (current && (!readyCallback || typeof current.render === "function")) {
      return resolve(current as TApi);
    }

    const finish = () => {
      const api = host[global];
      if (api) resolve(api as TApi);
      else reject(new Error(`${src} loaded without defining window.${global}.`));
    };

    const { document } = runtimeWindow;
    const script = document.createElement("script");
    script.async = true;
    script.dataset.farmBotScript = "";
    // Carry the page's CSP nonce so a nonce-only policy still runs the provider script.
    const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
    if (nonce) script.nonce = nonce;

    if (readyCallback) {
      const callback = `__farmBotReady${registry.callbacks++}`;
      host[callback] = () => {
        delete host[callback];
        finish();
      };
      script.src = `${src}${src.includes("?") ? "&" : "?"}onload=${callback}`;
    } else {
      script.src = src;
      script.addEventListener("load", finish, { once: true });
    }

    script.addEventListener(
      "error",
      () => {
        script.remove();
        reject(
          new Error(`Couldn't load ${src}. Check the network, and that the page's CSP allows it.`),
        );
      },
      { once: true },
    );
    document.head.append(script);
  });

  registry.scripts.set(src, loading);
  // Let the next widget retry after a failed load.
  loading.catch(() => {
    if (registry.scripts.get(src) === loading) registry.scripts.delete(src);
  });
  return loading;
}
