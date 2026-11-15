import type { BotProvider } from "@farm.js/bot";
import { hcaptcha, recaptcha, turnstile } from "@farm.js/bot/captcha";
import { timeTrap } from "./time-trap";

// Lets the end-to-end run use test keys against a production build.
const testKeys = process.env.BOT_TEST_KEYS === "1" ? true : undefined;

export function botProvider(): BotProvider {
  switch (process.env.BOT_PROVIDER) {
    case "hcaptcha":
      return hcaptcha({ testKeys });
    case "recaptcha":
      return recaptcha({ testKeys });
    case "time-trap":
      return timeTrap();
    default:
      return turnstile({ testKeys });
  }
}
