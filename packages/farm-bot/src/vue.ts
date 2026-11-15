import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue";
import { mountBotCheck, type BotTheme, type BotWidget, type BotWidgetOptions } from "./client.js";

export type { BotCheckHandle } from "./client.js";

/** The bot check widget. Put it inside the form it protects. */
export const BotCheck = defineComponent({
  name: "BotCheck",
  props: {
    theme: String as PropType<BotTheme>,
    settings: Object as PropType<BotWidgetOptions["settings"]>,
    // Declared as props so `@verify`, `@error`, and `@expire` arrive as `onVerify` and friends.
    onVerify: Function as PropType<BotWidgetOptions["onVerify"]>,
    onError: Function as PropType<BotWidgetOptions["onError"]>,
    onExpire: Function as PropType<BotWidgetOptions["onExpire"]>,
  },
  setup(props, { expose }) {
    const element = ref<HTMLDivElement>();
    let widget: BotWidget | undefined;

    const mount = () => {
      if (element.value) widget = mountBotCheck(element.value, () => props);
    };

    onMounted(mount);
    // Compare a string, because an inline `settings` object is new on every parent render.
    watch(
      () => JSON.stringify([props.theme, props.settings ?? null]),
      () => {
        widget?.remove();
        props.onExpire?.();
        mount();
      },
    );
    onBeforeUnmount(() => widget?.remove());
    expose({ reset: () => widget?.reset() });

    return () => h("div", { ref: element, "data-farm-bot": "" });
  },
});
