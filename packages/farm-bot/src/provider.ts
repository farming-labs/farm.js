import { BotError } from "./errors.js";

export const BOT_FAILURE_CODES = [
  "missing_token",
  "rejected",
  "expired",
  "hostname_mismatch",
  "unavailable",
] as const;

/** Why a submission was refused. */
export type BotFailureCode = (typeof BOT_FAILURE_CODES)[number];

/** CSP sources a provider's browser half needs, per directive. */
export type BotCspSources = Readonly<Record<string, readonly string[]>>;

/** What a provider receives for each submission. */
export interface BotVerifyInput {
  /** The value of the provider's `tokenField`, or the string passed to `verify()`. */
  token: string | undefined;
  /** The submitted form, when `verify()` was given one. */
  form: FormData | undefined;
  /** The request being handled, when there is one. */
  request: Request | undefined;
  /** The visitor's IP, when the app passed it. */
  remoteIp: string | undefined;
  /** Aborted at `timeoutMs`. Pass it to `fetch`. */
  signal: AbortSignal;
}

export interface BotVerdictPass<TData = unknown> {
  success: true;
  /** Where the check was solved. Farm refuses any other site. Leave it out if none is reported. */
  hostname?: string;
  /** The check ran on the provider's test keys. */
  testKeys?: boolean;
  /** Anything the app may want from the provider, such as a score. Returned as `check.data`. */
  data?: TData;
}

export interface BotVerdictFail {
  success: false;
  code: BotFailureCode;
  /** The provider's own error codes, for logs. */
  providerCodes?: readonly string[];
}

export type BotVerdict<TData = unknown> = BotVerdictPass<TData> | BotVerdictFail;

export interface BotClientState {
  close(): void;
}

/** Where a provider's browser code lives, and what it's given. */
export interface BotProviderClient {
  /**
   * A module whose default export is `defineBotWidget(...)`. Either a package path such as
   * `acme-bot/widget`, or a path from the app root such as `/src/acme.widget.ts`.
   */
  widget: string;
  /** Passed to the widget. It's compiled into the browser bundle, so never put a secret here. */
  public?: unknown;
}

/** The contract any bot checker implements. It is a plain object. */
export interface BotProvider<TData = unknown> {
  /** Shown in results and logs. Lowercase letters, numbers, and dashes. */
  readonly name: string;
  /** The form field holding the token. Leave it out for a check that sends no token. */
  readonly tokenField?: string;
  /** Longer tokens are refused without calling `verify`. */
  readonly maxTokenLength?: number;
  /** Added to the app's `security.csp` so the policy doesn't block the browser half. */
  readonly csp?: BotCspSources;
  /** Called once when Farm loads the config, never during a request. */
  client?(): BotProviderClient;
  /** Decide whether a submission came from a person. Throw only for a configuration mistake. */
  verify(input: BotVerifyInput): Promise<BotVerdict<TData>>;
}

const PROVIDER_NAME = /^[a-z0-9][a-z0-9-]*$/;
const CSP_DIRECTIVE = /^[a-z][a-z-]*$/;
const CSP_SOURCE = /^[^\s;,]+$/;

/** Every problem with a provider object, as sentences. Empty when it's valid. */
export function botProviderIssues(provider: unknown): string[] {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    return [
      "The provider must be an object. Use one from `@farm.js/bot/captcha`, or write your own with `defineBotProvider`.",
    ];
  }
  const { name, tokenField, maxTokenLength, csp, client, verify } = provider as Record<
    string,
    unknown
  >;
  const issues: string[] = [];

  if (typeof name !== "string" || !PROVIDER_NAME.test(name)) {
    issues.push("`name` must use only lowercase letters, numbers, and dashes.");
  }
  if (typeof verify !== "function") issues.push("`verify` must be a function.");
  if (client !== undefined && typeof client !== "function") {
    issues.push("`client` must be a function that returns `{ widget, public }`.");
  }
  if (tokenField !== undefined && (typeof tokenField !== "string" || !tokenField.trim())) {
    issues.push("`tokenField` must be a non-empty string.");
  }
  if (
    maxTokenLength !== undefined &&
    (typeof maxTokenLength !== "number" || !Number.isInteger(maxTokenLength) || maxTokenLength <= 0)
  ) {
    issues.push("`maxTokenLength` must be a positive integer.");
  }
  if (csp !== undefined) issues.push(...cspIssues(csp));

  return issues;
}

/** Every problem with what `client()` returned, as sentences. Empty when it's valid. */
export function botClientIssues(client: unknown): string[] {
  const widget = (client as { widget?: unknown } | null | undefined)?.widget;
  if (typeof widget !== "string" || !widget.trim()) {
    return ["`client()` must return `{ widget }`, the import path of the browser module."];
  }
  if (widget.startsWith(".")) {
    return [
      `\`client().widget\` can't be a relative path ("${widget}"). Use a package path, or a path from the app root such as "/src/acme.widget.ts".`,
    ];
  }
  return [];
}

function cspIssues(csp: unknown): string[] {
  if (!csp || typeof csp !== "object" || Array.isArray(csp)) {
    return ["`csp` must map directive names to arrays of sources."];
  }
  const issues: string[] = [];
  for (const [directive, sources] of Object.entries(csp)) {
    if (!CSP_DIRECTIVE.test(directive)) {
      issues.push(`\`csp\` has an invalid directive name: ${JSON.stringify(directive)}.`);
    }
    if (!Array.isArray(sources) || sources.some((source) => !isCspSource(source))) {
      issues.push(
        `\`csp["${directive}"]\` must be an array of sources with no spaces or semicolons.`,
      );
    }
  }
  return issues;
}

function isCspSource(source: unknown): boolean {
  return typeof source === "string" && CSP_SOURCE.test(source);
}

export function assertBotProvider(provider: unknown): asserts provider is BotProvider {
  const issues = botProviderIssues(provider);
  if (issues.length === 0) return;
  const name = (provider as { name?: unknown } | null | undefined)?.name;
  const label = typeof name === "string" ? `Bot provider "${name}"` : "The bot provider";
  throw new BotError("invalid_provider", `${label} is invalid. ${issues.join(" ")}`);
}

/** Declare a bot checker. Pass the result to `bot({ provider })`. */
export function defineBotProvider<TData = undefined>(
  provider: BotProvider<TData>,
): BotProvider<TData> {
  assertBotProvider(provider);
  return provider;
}
