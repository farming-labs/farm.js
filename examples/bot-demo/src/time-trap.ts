import { defineBotProvider } from "@farm.js/bot";

/**
 * A bot checker written against the public contract: no vendor, no keys, and its own browser
 * code. It only shows the shape. A script can forge this token, so don't rely on it.
 */
export function timeTrap({ minMs = 800 }: { minMs?: number } = {}) {
  return defineBotProvider({
    name: "time-trap",
    tokenField: "time-trap",
    client: () => ({ widget: "/src/time-trap.widget.ts", public: { minMs } }),

    async verify({ token }) {
      const elapsedMs = Date.now() - Number(token);
      if (!Number.isFinite(elapsedMs) || elapsedMs < minMs) {
        return { success: false, code: "rejected" };
      }
      return { success: true, data: { elapsedMs } };
    },
  });
}
