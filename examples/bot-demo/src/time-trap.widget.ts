import { defineBotWidget } from "@farm.js/bot/client";

export default defineBotWidget<{ minMs: number }>(({ minMs }) => ({
  mount(_element, { onVerify }) {
    let timer: ReturnType<typeof setTimeout>;
    const start = () => {
      const startedAt = String(Date.now());
      timer = setTimeout(() => onVerify(startedAt), minMs);
    };
    start();

    return {
      reset() {
        clearTimeout(timer);
        start();
      },
      remove() {
        clearTimeout(timer);
      },
    };
  },
}));
