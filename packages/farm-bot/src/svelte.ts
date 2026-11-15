import {
  mountBotCheck,
  type BotCheckHandle,
  type BotWidget,
  type BotWidgetOptions,
} from "./client.js";

export type { BotCheckHandle } from "./client.js";

export interface BotCheckActionOptions extends BotWidgetOptions {
  /** Receives a handle with `reset()`, for example to ask for a new token after a failed submit. */
  ref?: (handle: BotCheckHandle) => void;
}

const appearance = (options: BotCheckActionOptions) =>
  JSON.stringify([options.theme, options.settings ?? null]);

/** Show the bot check in an element inside a form: `<div use:botCheck={{ onVerify }}></div>`. */
export function botCheck(node: HTMLElement, options: BotCheckActionOptions = {}) {
  let current = options;
  let widget: BotWidget = mountBotCheck(node, () => current);
  current.ref?.({ reset: () => widget.reset() });

  return {
    update(next: BotCheckActionOptions = {}) {
      const changed = appearance(next) !== appearance(current);
      current = next;
      if (changed) {
        widget.remove();
        current.onExpire?.();
        widget = mountBotCheck(node, () => current);
      }
    },
    destroy() {
      widget.remove();
    },
  };
}
