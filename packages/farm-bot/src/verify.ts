import { getCurrentRequest } from "@farm.js/core/request";
import { BotError } from "./errors.js";
import { isDevelopment } from "./keys.js";
import {
  BOT_FAILURE_CODES,
  type BotFailureCode,
  type BotProvider,
  type BotVerdict,
} from "./provider.js";

// A provider with a documented limit sets its own. This stops junk from being forwarded.
const DEFAULT_MAX_TOKEN_LENGTH = 32_768;

export interface BotCheckVerifyOptions {
  /** The request the form arrived with. Defaults to the request being handled. */
  request?: Request;
  /** The visitor's IP, forwarded to the provider. Omit it unless your proxy sets it reliably. */
  remoteIp?: string;
}

export interface BotCheckSuccess<TData = unknown> {
  success: true;
  provider: string;
  /** The hostname the provider saw the check on, when it reports one. */
  hostname: string | undefined;
  /** Whether the check ran on the provider's test keys. */
  testKeys: boolean;
  /** Provider details, such as a score or the raw verify response. */
  data: TData | undefined;
}

export interface BotCheckFailure {
  success: false;
  provider: string;
  code: BotFailureCode;
  /** A sentence that is safe to show the visitor. */
  message: string;
  /** The HTTP status to answer with: 403, or 503 when the provider can't be reached. */
  status: 403 | 503;
  /** The provider's raw error codes, for logs. */
  providerCodes: readonly string[];
}

export type BotCheckResult<TData = unknown> = BotCheckSuccess<TData> | BotCheckFailure;

export interface BotCheckVerifySettings<TData = unknown> {
  provider: BotProvider<TData>;
  hostnames: readonly string[] | undefined;
  timeoutMs: number;
}

const MESSAGES: Record<BotFailureCode, string> = {
  missing_token: "Complete the bot check, then send the form again.",
  rejected: "The bot check failed. Try again.",
  expired: "The bot check expired. Complete it again, then send the form again.",
  hostname_mismatch: "The bot check failed. Try again.",
  unavailable: "The bot check is unavailable right now. Try again in a moment.",
};

export async function verifyBotCheck<TData>(
  settings: BotCheckVerifySettings<TData>,
  input: FormData | string | null | undefined,
  options: BotCheckVerifyOptions = {},
): Promise<BotCheckResult<TData>> {
  const { provider } = settings;
  const fail = (code: BotFailureCode, providerCodes: readonly string[] = []) =>
    failure(provider.name, code, providerCodes);

  // `farm build` reports this from `configure`; this covers a server that skipped that check.
  if (settings.hostnames === undefined && !isDevelopment()) throw missingHostnamesError();

  const form = isForm(input) ? input : undefined;
  const token = typeof input === "string" ? input : readToken(form, provider.tokenField);

  if (provider.tokenField !== undefined) {
    if (token === undefined || token.length === 0) return fail("missing_token");
    if (token.length > (provider.maxTokenLength ?? DEFAULT_MAX_TOKEN_LENGTH)) {
      return fail("rejected");
    }
  }

  const request = options.request ?? currentRequest();
  const signal = AbortSignal.timeout(settings.timeoutMs);

  let verdict: BotVerdict<TData>;
  try {
    verdict = await raceAbort(
      () => provider.verify({ token, form, request, remoteIp: options.remoteIp, signal }),
      signal,
    );
  } catch (error) {
    // A timed-out check refuses the submission. Anything else is the provider reporting a bug.
    if (signal.aborted) return fail("unavailable", ["timeout"]);
    throw error;
  }

  if (verdict?.success === false) {
    const code = BOT_FAILURE_CODES.includes(verdict.code) ? verdict.code : "rejected";
    return fail(code, verdict.providerCodes);
  }
  if (verdict?.success !== true) {
    throw new BotError(
      "invalid_provider",
      `Bot provider "${provider.name}" returned an invalid result. \`verify\` must return \`{ success: true }\` or \`{ success: false, code }\`.`,
    );
  }

  if (verdict.hostname !== undefined && typeof verdict.hostname !== "string") {
    throw new BotError(
      "invalid_provider",
      `Bot provider "${provider.name}" returned an invalid \`hostname\`. Return a string, or leave it out when the provider doesn't report one.`,
    );
  }
  const hostname = verdict.hostname?.toLowerCase();
  if (hostname !== undefined) {
    const allowed = settings.hostnames ?? [requestHostname(request)];
    if (!allowed.some((candidate) => candidate.toLowerCase() === hostname)) {
      return fail("hostname_mismatch");
    }
  }

  return {
    success: true,
    provider: provider.name,
    hostname,
    testKeys: verdict.testKeys === true,
    data: verdict.data,
  };
}

// A JSON API can hand over anything a visitor sent, so don't assume the declared type.
function isForm(input: unknown): input is FormData {
  return (
    typeof input === "object" && input !== null && typeof (input as FormData).get === "function"
  );
}

function readToken(form: FormData | undefined, tokenField: string | undefined): string | undefined {
  if (!form || tokenField === undefined) return undefined;
  const value = form.get(tokenField);
  return typeof value === "string" ? value : undefined;
}

/** Enforce the timeout even for a provider that ignores its `signal`. */
function raceAbort<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([
    new Promise<T>((resolve) => resolve(run())),
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  ]);
}

function currentRequest(): Request | undefined {
  try {
    return getCurrentRequest();
  } catch {
    // Outside a request, the hostname check reports what to pass instead.
    return undefined;
  }
}

/** Outside development the request's host can't be trusted, so the app must list its own. */
export function missingHostnamesError(): BotError {
  return new BotError(
    "missing_hostnames",
    '`bot()` needs `hostnames` outside development, for example `hostnames: ["example.com"]`. A request can claim any host, so a production check only trusts the hostnames you list.',
  );
}

function requestHostname(request: Request | undefined): string {
  if (!request) {
    throw new BotError(
      "missing_request",
      "Checking a bot token needs the request, to see where the token came from. Pass `{ request }`, or set `hostnames` in `bot()`.",
    );
  }
  return new URL(request.url).hostname;
}

function failure(
  provider: string,
  code: BotFailureCode,
  providerCodes: readonly string[],
): BotCheckFailure {
  return {
    success: false,
    provider,
    code,
    message: MESSAGES[code],
    status: code === "unavailable" ? 503 : 403,
    providerCodes,
  };
}
