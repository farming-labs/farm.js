import { createComponent, createEffect, createMemo, on, onCleanup, onMount } from "solid-js";
import { Dynamic } from "solid-js/web";
import {
  mountBotCheck,
  type BotCheckHandle,
  type BotWidget,
  type BotWidgetOptions,
} from "./client.js";

export type { BotCheckHandle } from "./client.js";

export interface BotCheckProps extends BotWidgetOptions {
  class?: string;
  ref?: (handle: BotCheckHandle) => void;
}

/** The bot check widget. Put it inside the form it protects. */
export function BotCheck(props: BotCheckProps) {
  let element: HTMLDivElement | undefined;
  let widget: BotWidget | undefined;

  const mount = () => {
    if (element) widget = mountBotCheck(element, () => props);
  };

  onMount(() => {
    mount();
    props.ref?.({ reset: () => widget?.reset() });
  });

  // A memo of a string, because an inline `settings` object is new on every update.
  const appearance = createMemo(() => JSON.stringify([props.theme, props.settings ?? null]));

  createEffect(
    on(
      appearance,
      () => {
        widget?.remove();
        props.onExpire?.();
        mount();
      },
      { defer: true },
    ),
  );

  onCleanup(() => widget?.remove());

  return createComponent(Dynamic as never, {
    component: "div",
    get class() {
      return props.class;
    },
    "data-farm-bot": "",
    ref(node: HTMLDivElement) {
      element = node;
    },
  });
}
