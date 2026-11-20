import { standardWebhooks } from "./schemes.js";
import {
  encodeBase64,
  hmacKey,
  secretKeyBytes,
  utf8,
  WebhookVerificationError,
  type WebhookScheme,
} from "./shared.js";

export { github, standardWebhooks } from "./schemes.js";
export {
  WebhookVerificationError,
  type WebhookScheme,
  type WebhookSchemeInput,
  type WebhookSchemeResult,
  type WebhookVerificationErrorCode,
} from "./shared.js";

/** A Standard Schema validator, such as a Zod, Valibot or ArkType schema. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaIssue> };

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

type SchemaOutput<TSchema> =
  TSchema extends StandardSchemaV1<unknown, infer Output> ? Output : unknown;

/** A request, or the raw body and headers when something else already read the request. */
export type WebhookInput =
  | Request
  | { body: string | Uint8Array | ArrayBuffer; headers: HeadersInit };

export interface VerifyWebhookOptions<TSchema extends StandardSchemaV1 | undefined = undefined> {
  /**
   * The signing secret from the sender. A Standard Webhooks secret starts with `whsec_`; any
   * other string is used as its UTF-8 bytes. Pass several to accept each during a rotation.
   */
  secret: string | readonly string[];
  /** How the sender signs. Default: `standardWebhooks()`, which Svix-based senders also use. */
  scheme?: WebhookScheme | undefined;
  /** Validates the parsed JSON body, which then types `payload`. */
  schema?: TSchema | undefined;
  /** How far a signed timestamp may be from now, in seconds. Default 300, as the spec says. */
  toleranceSeconds?: number | undefined;
}

export interface WebhookEvent<TPayload = unknown> {
  /** The sender's message id. The same message can arrive more than once: dedupe on it. */
  id: string;
  /** The event type, from the scheme's headers or the payload's `type` field. */
  type: string | undefined;
  /** When the sender signed the message, for schemes that sign a timestamp. */
  timestamp: Date | undefined;
  /** The parsed JSON body, validated by `schema` when one is given. */
  payload: TPayload;
  /** The raw body, exactly as signed. */
  body: string;
}

/**
 * Verify a signed webhook and return its parsed body. Throws `WebhookVerificationError` when the
 * signature, timestamp, headers or body don't check out, so nothing unverified reaches your code.
 *
 * ```ts
 * const event = await verifyWebhook(request, { secret: process.env.WEBHOOK_SECRET! });
 * ```
 */
export async function verifyWebhook<TSchema extends StandardSchemaV1 | undefined = undefined>(
  input: WebhookInput,
  options: VerifyWebhookOptions<TSchema>,
): Promise<WebhookEvent<SchemaOutput<TSchema>>> {
  const secrets = resolveSecrets(options.secret, "verify");
  const toleranceSeconds = options.toleranceSeconds ?? 300;
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    throw new TypeError("`toleranceSeconds` must be a number of seconds, 0 or more.");
  }

  const headers = input instanceof Request ? input.headers : new Headers(input.headers);
  const raw = input instanceof Request ? new Uint8Array(await input.arrayBuffer()) : input.body;
  const body = typeof raw === "string" ? utf8(raw) : new Uint8Array(raw);

  const signed = await (options.scheme ?? standardWebhooks()).verify({
    body,
    headers,
    secrets,
    toleranceSeconds,
    now: Date.now(),
  });

  const text = new TextDecoder().decode(body);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (cause) {
    throw new WebhookVerificationError(
      "INVALID_BODY",
      "The webhook's signature is valid, but its body isn't JSON. Ask the sender to send `application/json`.",
      { cause },
    );
  }
  if (options.schema) {
    const result = await options.schema["~standard"].validate(payload);
    if (result.issues) {
      throw new WebhookVerificationError(
        "INVALID_PAYLOAD",
        `The webhook's body doesn't match \`schema\`: ${result.issues.map(formatIssue).join("; ")}`,
        { issues: result.issues },
      );
    }
    payload = result.value;
  }

  const payloadType =
    payload &&
    typeof payload === "object" &&
    typeof (payload as { type?: unknown }).type === "string"
      ? (payload as { type: string }).type
      : undefined;
  return {
    id: signed.id,
    type: signed.type ?? payloadType,
    timestamp: signed.timestamp,
    payload: payload as SchemaOutput<TSchema>,
    body: text,
  };
}

export interface SignWebhookOptions {
  /** The endpoint's secret. Pass the new and the old one during a rotation to sign with both. */
  secret: string | readonly string[];
  /** The exact body you will send. */
  body: string;
  /** The message id. Reuse it when you retry, so the receiver can drop the repeat. */
  id?: string | undefined;
  /** When the message is signed. Default: now. */
  timestamp?: Date | undefined;
}

export type StandardWebhookHeaders = {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
};

/**
 * Sign a body with Standard Webhooks `v1`, for sending webhooks to your own users. Send the body
 * with the returned headers; any Standard Webhooks library can verify it.
 */
export async function signWebhook(options: SignWebhookOptions): Promise<StandardWebhookHeaders> {
  const secrets = resolveSecrets(options.secret, "sign");
  const id = options.id ?? `msg_${crypto.randomUUID()}`;
  const timestamp = String(Math.floor((options.timestamp ?? new Date()).getTime() / 1000));
  const content = utf8(`${id}.${timestamp}.${options.body}`);
  const signatures = await Promise.all(
    secrets.map(async (secret) => {
      const key = await hmacKey(secretKeyBytes(secret), "sign");
      const signature = await crypto.subtle.sign("HMAC", key, content);
      return `v1,${encodeBase64(new Uint8Array(signature))}`;
    }),
  );
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": signatures.join(" "),
  };
}

function resolveSecrets(
  secret: string | readonly string[] | undefined,
  use: "sign" | "verify",
): string[] {
  const secrets = (typeof secret === "string" ? [secret] : [...(secret ?? [])]).filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  if (secrets.length > 0) return secrets;
  // An unset environment variable lands here: fail instead of accepting or signing with nothing.
  const message =
    "`secret` is empty. Set it to the endpoint's signing secret, for example `secret: process.env.WEBHOOK_SECRET`.";
  if (use === "sign") throw new TypeError(message);
  throw new WebhookVerificationError("INVALID_SECRET", message);
}

function formatIssue(issue: StandardSchemaIssue): string {
  const path = issue.path
    ?.map((segment) => String(typeof segment === "object" ? segment.key : segment))
    .join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
