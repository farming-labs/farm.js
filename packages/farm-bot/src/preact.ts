import { h } from "preact";
import { forwardRef } from "preact/compat";
import { useEffect, useImperativeHandle, useRef } from "preact/hooks";
import {
  mountBotCheck,
  type BotCheckHandle,
  type BotWidget,
  type BotWidgetOptions,
} from "./client.js";

export type { BotCheckHandle } from "./client.js";

export interface BotCheckProps extends BotWidgetOptions {
  className?: string;
}

/** The bot check widget. Put it inside the form it protects. */
export const BotCheck = forwardRef<BotCheckHandle, BotCheckProps>(function BotCheck(props, ref) {
  const element = useRef<HTMLDivElement>(null);
  const widget = useRef<BotWidget | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({ reset: () => widget.current?.reset() }), []);

  const { className, theme, settings } = props;
  const appearance = JSON.stringify([theme, settings ?? null]);
  const mountedAppearance = useRef(appearance);

  useEffect(() => {
    if (!element.current) return;
    // A new widget has no token yet, so the form can't still count as verified.
    if (mountedAppearance.current !== appearance) {
      mountedAppearance.current = appearance;
      latest.current.onExpire?.();
    }
    const mounted = mountBotCheck(element.current, () => latest.current);
    widget.current = mounted;
    return () => {
      mounted.remove();
      widget.current = null;
    };
  }, [appearance]);

  return h("div", { ref: element, class: className, "data-farm-bot": "" });
});
