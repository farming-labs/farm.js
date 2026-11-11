import {
  defineBotWidget,
  loadBotScript,
  type BotTheme,
  type BotWidget,
  type BotWidgetDriver,
} from "../client.js";

/** JSON describing a widget loaded from a provider's script. */
export interface ScriptWidgetConfig {
  name: string;
  siteKey: string;
  /** Should request explicit rendering, so Farm controls when the widget mounts. */
  scriptUrl: string;
  /** The browser global the script defines. */
  global: string;
  /** The provider accepts `theme: "auto"`. Otherwise Farm resolves it from the color scheme. */
  autoTheme?: boolean;
  /** The script signals readiness through an `onload` callback instead of its load event. */
  readyCallback?: boolean;
}

/** The calls a script widget needs. `remove` is optional because reCAPTCHA has none. */
interface ScriptWidgetApi {
  render(element: HTMLElement, options: Record<string, unknown>): string | number | undefined;
  reset(widgetId: string | number): void;
  remove?(widgetId: string | number): void;
}

const NOOP_WIDGET: BotWidget = { reset() {}, remove() {} };

function resolveTheme(
  theme: BotTheme,
  autoTheme: boolean | undefined,
  runtimeWindow: Window,
): BotTheme {
  if (theme !== "auto" || autoTheme) return theme;
  return runtimeWindow.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The browser half for a captcha whose script offers `render`, `reset`, and maybe `remove`. */
export function createScriptWidget(config: ScriptWidgetConfig): BotWidgetDriver {
  return {
    async mount(element, mount) {
      const { ownerDocument: document } = element;
      const runtimeWindow = document.defaultView!;
      const api = await loadBotScript<ScriptWidgetApi>(config.scriptUrl, config, runtimeWindow);
      if (mount.signal.aborted) return NOOP_WIDGET;

      // reCAPTCHA can't render twice into one element, so every widget gets its own host.
      const host = document.createElement("div");
      element.append(host);

      let widgetId: string | number | undefined;
      try {
        widgetId = api.render(host, {
          ...mount.settings,
          sitekey: config.siteKey,
          theme: resolveTheme(mount.theme, config.autoTheme, runtimeWindow),
          callback: mount.onVerify,
          "expired-callback": mount.onExpire,
          "error-callback": (code: unknown) => {
            const detail = code === undefined ? "" : ` with code ${String(code)}`;
            mount.onError(new Error(`The ${config.name} widget failed${detail}.`));
          },
        });
      } catch (error) {
        host.remove();
        throw error;
      }

      return {
        reset() {
          if (widgetId !== undefined) api.reset(widgetId);
        },
        remove() {
          if (widgetId !== undefined) api.remove?.(widgetId);
          host.remove();
        },
      };
    },
  };
}

export default defineBotWidget<ScriptWidgetConfig>(createScriptWidget);
