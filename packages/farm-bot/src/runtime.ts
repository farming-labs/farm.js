import type { BotCheckResult, BotCheckVerifyOptions } from "./verify.js";

export type BotVerifier<TData = unknown> = (
  input: FormData | string | null | undefined,
  options?: BotCheckVerifyOptions,
) => Promise<BotCheckResult<TData>>;

// On the global because `farm dev` loads the config and the app's routes as separate module copies.
const RUNTIME_KEY = Symbol.for("@farm.js/bot/runtime");

type GlobalBotState = typeof globalThis & { [RUNTIME_KEY]?: BotVerifier };

export function setBotVerifier(verifier: BotVerifier): void {
  (globalThis as GlobalBotState)[RUNTIME_KEY] = verifier;
}

export function getBotVerifier(): BotVerifier | undefined {
  return (globalThis as GlobalBotState)[RUNTIME_KEY];
}
