import type { BotWidgetDriver, BotWidgetFactory } from "./client.js";
import {
  BOT_FAILURE_CODES,
  botClientIssues,
  botProviderIssues,
  type BotProvider,
} from "./provider.js";

export interface BotProviderCheckOptions {
  /** A token the provider must refuse. Defaults to an obviously invalid string. */
  invalidToken?: string;
  /** A form the provider must refuse, for a check that reads more than the token. */
  invalidForm?: FormData;
  /** Secrets that must never reach the browser. */
  secrets?: readonly string[];
  /** The request to verify with, for a check that reads headers or the URL. */
  request?: Request;
  /** The visitor's IP to verify with. */
  remoteIp?: string;
  /** Your module's `defineBotWidget(...)`, to run its lifecycle. Needs a DOM such as jsdom. */
  widget?: BotWidgetFactory<any>;
}

/** The same values Farm's client build accepts in `public`. */
function isPublicData(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPublicData);
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value as object).every(isPublicData)
  );
}

/** Mount, reset, and remove the widget, as a page does when it unmounts a form. */
async function widgetIssues(create: BotWidgetFactory<any>, config: unknown): Promise<string[]> {
  if (typeof document === "undefined") {
    return ["Checking `widget` needs a DOM. Run this test in jsdom or happy-dom."];
  }
  const element = document.createElement("div");
  document.body.append(element);
  try {
    const driver: BotWidgetDriver | void = await create(config);
    if (driver === undefined) return [];
    if (typeof driver?.mount !== "function") {
      return ["`widget` must return an object with `mount`, or nothing if it draws nothing."];
    }
    const widget = await driver.mount(element, {
      theme: "auto",
      settings: {},
      signal: new AbortController().signal,
      onVerify() {},
      onError() {},
      onExpire() {},
    });
    if (typeof widget?.reset !== "function" || typeof widget?.remove !== "function") {
      return ["`mount` must return `{ reset, remove }`."];
    }
    widget.reset();
    widget.remove();
    return element.childNodes.length > 0
      ? ["`remove` left elements behind, so a remounted form would show the check twice."]
      : [];
  } catch (error) {
    return [`\`widget\` threw: ${String(error)}`];
  } finally {
    element.remove();
  }
}

/**
 * Check a provider against the contract. Returns every problem as a sentence, so an empty array
 * means it conforms: `expect(await checkBotProvider(acme())).toEqual([])`.
 */
export async function checkBotProvider(
  provider: BotProvider,
  options: BotProviderCheckOptions = {},
): Promise<string[]> {
  const issues = botProviderIssues(provider);
  if (issues.length > 0) return issues;

  if (provider.client) {
    try {
      const client = provider.client();
      issues.push(...botClientIssues(client));
      if (client?.public !== undefined && !isPublicData(client.public)) {
        issues.push("`client().public` must be plain JSON.");
      }
      const json = JSON.stringify(client?.public ?? null) ?? "";
      if ((options.secrets ?? []).some((secret) => json.includes(secret))) {
        issues.push("`client().public` contains a secret.");
      }
      if (options.widget) issues.push(...(await widgetIssues(options.widget, client?.public)));
    } catch (error) {
      issues.push(`\`client()\` threw: ${String(error)}`);
    }
  }

  try {
    const verdict = await provider.verify({
      token: options.invalidToken ?? "farm-bot-invalid-token",
      form: options.invalidForm,
      request: options.request ?? new Request("https://example.com/"),
      remoteIp: options.remoteIp,
      signal: new AbortController().signal,
    });
    if (verdict?.success === true) {
      issues.push("`verify` accepted a submission it should refuse.");
    } else if (verdict?.success !== false) {
      issues.push("`verify` must return `{ success: true }` or `{ success: false, code }`.");
    } else if (!BOT_FAILURE_CODES.includes(verdict.code)) {
      issues.push(`\`verify\` returned an unknown code: ${String(verdict.code)}.`);
    }
  } catch (error) {
    issues.push(`\`verify\` threw on a submission it should refuse: ${String(error)}`);
  }

  return issues;
}
