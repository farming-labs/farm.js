import {
  BotError,
  createBotKeys,
  defineBotProvider,
  type BotCspSources,
  type BotKeysConfig,
  type BotProvider,
  type BotProviderKeys,
  type BotVerdict,
  type BotVerifyInput,
} from "../index.js";
import type { ScriptWidgetConfig } from "./widget.js";

/** The JSON a siteverify endpoint answers with. Field names are the provider's own. */
export interface SiteverifyResponse {
  success?: unknown;
  hostname?: unknown;
  challenge_ts?: unknown;
  "error-codes"?: unknown;
  [field: string]: unknown;
}

export interface SiteverifyProviderConfig extends BotKeysConfig {
  /** The form field the widget fills with its token. */
  tokenField: string;
  maxTokenLength?: number;
  verifyUrl: string;
  /** The provider's script. Leave it out and set `client` yourself for your own browser code. */
  widget?: Omit<ScriptWidgetConfig, "name" | "siteKey">;
  secretKeyEnv: string;
  csp: BotCspSources;
  /** Provider error codes beyond the ones most siteverify endpoints share. */
  codes?: {
    /** The token expired or was already used. */
    expired?: readonly string[];
    /** The secret key itself is wrong, which the app owner has to fix. */
    secret?: readonly string[];
    /** The provider failed, so the visitor isn't at fault. */
    unavailable?: readonly string[];
  };
  /** Values the provider reports when it doesn't know the hostname. */
  unknownHostnames?: readonly string[];
}

const SHARED_CODES = {
  expired: ["timeout-or-duplicate"],
  secret: ["missing-input-secret", "invalid-input-secret"],
  unavailable: ["bad-request", "internal-error"],
} as const;

/**
 * Build a provider for a checker that has a script widget and a siteverify endpoint: a form POST
 * of `secret` and `response` that answers `{ success, hostname, "error-codes" }`.
 */
export function createSiteverifyProvider(
  config: SiteverifyProviderConfig,
  options?: BotProviderKeys,
): BotProvider<SiteverifyResponse> {
  const keys = createBotKeys(config, options);

  const hasCode = (codes: readonly string[], kind: keyof typeof SHARED_CODES) =>
    codes.some(
      (code) => SHARED_CODES[kind].includes(code as never) || config.codes?.[kind]?.includes(code),
    );

  async function verify(input: BotVerifyInput): Promise<BotVerdict<SiteverifyResponse>> {
    const unavailable = (code: string): BotVerdict<SiteverifyResponse> => ({
      success: false,
      code: "unavailable",
      providerCodes: [code],
    });

    const { value: secret, isTest: testSecret } = keys.secretKey();
    const body = new URLSearchParams({ secret, response: input.token ?? "" });
    if (input.remoteIp) body.set("remoteip", input.remoteIp);

    let data: SiteverifyResponse | null | undefined;
    let ok: boolean;
    let status: number;
    try {
      const response = await fetch(config.verifyUrl, {
        method: "POST",
        body,
        signal: input.signal,
      });
      ok = response.ok;
      status = response.status;
      // Turnstile answers a wrong secret with HTTP 400 and the reason in the body.
      data = (await response.json().catch(() => undefined)) as typeof data;
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      return unavailable(typeof name === "string" ? name : "error");
    }

    const providerCodes =
      data && Array.isArray(data["error-codes"])
        ? data["error-codes"].filter((code): code is string => typeof code === "string")
        : [];

    if (!ok && providerCodes.length === 0) return unavailable(`http_${status}`);
    if (!data || typeof data !== "object") return unavailable("invalid_response");

    if (!ok || data.success !== true) {
      if (hasCode(providerCodes, "secret")) {
        throw new BotError(
          "invalid_secret_key",
          `${config.name} rejected the secret key. Check \`${config.secretKeyEnv}\` against the key in your ${config.name} dashboard.`,
        );
      }
      if (hasCode(providerCodes, "unavailable")) {
        return { success: false, code: "unavailable", providerCodes };
      }
      if (hasCode(providerCodes, "expired")) {
        return { success: false, code: "expired", providerCodes };
      }
      return { success: false, code: "rejected", providerCodes };
    }

    // Test keys report a fixed placeholder hostname, so only real keys can be checked.
    if (testSecret) return { success: true, testKeys: true, data };

    const hostname = typeof data.hostname === "string" ? data.hostname : undefined;
    if (hostname !== undefined && config.unknownHostnames?.includes(hostname)) {
      return { success: true, data };
    }
    if (hostname === undefined) return { success: false, code: "hostname_mismatch", providerCodes };
    return { success: true, hostname, data };
  }

  const { widget } = config;
  return defineBotProvider<SiteverifyResponse>({
    name: config.name,
    tokenField: config.tokenField,
    ...(config.maxTokenLength === undefined ? {} : { maxTokenLength: config.maxTokenLength }),
    csp: config.csp,
    verify,
    ...(widget
      ? {
          client: () => ({
            widget: "@farm.js/bot/captcha/widget",
            public: { ...widget, name: config.name, siteKey: keys.siteKey() },
          }),
        }
      : {}),
  });
}
