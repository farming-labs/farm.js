import { BotError } from "./errors.js";
import { getBotVerifier } from "./runtime.js";
import type { BotCheckResult, BotCheckVerifyOptions } from "./verify.js";

export type {
  BotCheckFailure,
  BotCheckResult,
  BotCheckSuccess,
  BotCheckVerifyOptions,
} from "./verify.js";

/**
 * Check a submission with the `bot()` plugin from farm.config.ts. Visitor failures come back as
 * `{ success: false }` with a status and a message to show. Configuration mistakes throw a
 * `BotError`.
 */
export async function verifyBot<TData = unknown>(
  input: FormData | string | null | undefined,
  options?: BotCheckVerifyOptions,
): Promise<BotCheckResult<TData>> {
  const verify = getBotVerifier();
  if (!verify) {
    throw new BotError(
      "missing_plugin",
      "`verifyBot()` found no bot plugin. Add `bot({ provider })` to `plugins` in farm.config.ts. In `rsc` mode Farm doesn't run plugins yet, so keep the plugin in a variable and call its `verify` instead.",
    );
  }
  return verify(input, options) as Promise<BotCheckResult<TData>>;
}
