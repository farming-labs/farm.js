import type { BotProvider, BotProviderKeys } from "../index.js";
import { createSiteverifyProvider, type SiteverifyResponse } from "./siteverify.js";

type SiteverifyProvider = BotProvider<SiteverifyResponse>;

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const HCAPTCHA_SOURCES = ["https://hcaptcha.com", "https://*.hcaptcha.com"];

/** Cloudflare Turnstile. Keys default to `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. */
export function turnstile(keys?: BotProviderKeys): SiteverifyProvider {
  return createSiteverifyProvider(
    {
      name: "turnstile",
      tokenField: "cf-turnstile-response",
      maxTokenLength: 2048,
      verifyUrl: `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`,
      widget: {
        scriptUrl: `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`,
        global: "turnstile",
        autoTheme: true,
        readyCallback: true,
      },
      siteKeyEnv: "TURNSTILE_SITE_KEY",
      secretKeyEnv: "TURNSTILE_SECRET_KEY",
      csp: {
        "script-src": [TURNSTILE_ORIGIN],
        "frame-src": [TURNSTILE_ORIGIN],
      },
      testKeys: {
        siteKey: "1x00000000000000000000AA",
        secretKey: "1x0000000000000000000000000000000AA",
        isTestSecret: (secret) => /^[123]x0{31}AA$/.test(secret),
      },
    },
    keys,
  );
}

/** hCaptcha. Keys default to `HCAPTCHA_SITE_KEY` and `HCAPTCHA_SECRET_KEY`. */
export function hcaptcha(keys?: BotProviderKeys): SiteverifyProvider {
  return createSiteverifyProvider(
    {
      name: "hcaptcha",
      tokenField: "h-captcha-response",
      verifyUrl: "https://api.hcaptcha.com/siteverify",
      widget: {
        scriptUrl: "https://js.hcaptcha.com/1/api.js?render=explicit",
        global: "hcaptcha",
        readyCallback: true,
      },
      siteKeyEnv: "HCAPTCHA_SITE_KEY",
      secretKeyEnv: "HCAPTCHA_SECRET_KEY",
      csp: {
        "script-src": HCAPTCHA_SOURCES,
        "frame-src": HCAPTCHA_SOURCES,
        "style-src": HCAPTCHA_SOURCES,
        "connect-src": HCAPTCHA_SOURCES,
      },
      testKeys: {
        siteKey: "10000000-ffff-ffff-ffff-000000000001",
        secretKey: "0x0000000000000000000000000000000000000000",
      },
      codes: {
        expired: [
          "expired-input-response",
          "already-seen-response",
          "invalid-or-already-seen-response",
        ],
      },
      // hCaptcha documents this value for periods of unusually high traffic.
      unknownHostnames: ["not-provided"],
    },
    keys,
  );
}

/** reCAPTCHA v2 checkbox. Keys default to `RECAPTCHA_SITE_KEY` and `RECAPTCHA_SECRET_KEY`. */
export function recaptcha(keys?: BotProviderKeys): SiteverifyProvider {
  return createSiteverifyProvider(
    {
      name: "recaptcha",
      tokenField: "g-recaptcha-response",
      verifyUrl: "https://www.google.com/recaptcha/api/siteverify",
      widget: {
        scriptUrl: "https://www.google.com/recaptcha/api.js?render=explicit",
        global: "grecaptcha",
        readyCallback: true,
      },
      siteKeyEnv: "RECAPTCHA_SITE_KEY",
      secretKeyEnv: "RECAPTCHA_SECRET_KEY",
      csp: {
        "script-src": ["https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"],
        "frame-src": [
          "https://www.google.com/recaptcha/",
          "https://recaptcha.google.com/recaptcha/",
        ],
        "connect-src": ["https://www.google.com/recaptcha/"],
      },
      testKeys: {
        siteKey: "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
        secretKey: "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe",
      },
    },
    keys,
  );
}
