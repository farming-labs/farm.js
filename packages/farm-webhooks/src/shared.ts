export type WebhookVerificationErrorCode =
  | "INVALID_SECRET"
  | "MISSING_HEADERS"
  | "INVALID_TIMESTAMP"
  | "TIMESTAMP_OUT_OF_RANGE"
  | "INVALID_SIGNATURE"
  | "INVALID_BODY"
  | "INVALID_PAYLOAD";

/**
 * Why a webhook was refused. Answer the sender with a 4xx status: it retries a 5xx, and a
 * forged or stale message shouldn't be retried.
 */
export class WebhookVerificationError extends Error {
  readonly code: WebhookVerificationErrorCode;
  /** The schema's issues, for `INVALID_PAYLOAD`. */
  readonly issues: ReadonlyArray<{ readonly message: string }> | undefined;
  declare readonly cause?: unknown;

  constructor(
    code: WebhookVerificationErrorCode,
    message: string,
    options: {
      cause?: unknown;
      issues?: ReadonlyArray<{ readonly message: string }> | undefined;
    } = {},
  ) {
    super(message);
    if (options.cause !== undefined) this.cause = options.cause;
    this.name = "WebhookVerificationError";
    this.code = code;
    this.issues = options.issues;
  }
}

export interface WebhookSchemeInput {
  /** The raw body bytes, exactly as received. */
  body: Uint8Array;
  headers: Headers;
  /** Every accepted secret; a signature made with any of them passes. */
  secrets: readonly string[];
  toleranceSeconds: number;
  /** The current time, in milliseconds. */
  now: number;
}

export interface WebhookSchemeResult {
  id: string;
  type?: string | undefined;
  timestamp?: Date | undefined;
}

/**
 * How one sender signs its webhooks. `verify` throws `WebhookVerificationError` unless the
 * signature is valid, and returns the message's id. Write one for a sender with its own scheme.
 */
export interface WebhookScheme {
  name: string;
  verify(input: WebhookSchemeInput): Promise<WebhookSchemeResult>;
}

const encoder = new TextEncoder();

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(value) as Uint8Array<ArrayBuffer>;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

const SECRET_PREFIX = "whsec_";

/**
 * A Standard Webhooks secret is `whsec_` plus the base64 key. Any other string is used as its
 * UTF-8 bytes, as Farm's Polar and Autumn integrations already do.
 */
export function secretKeyBytes(secret: string): Uint8Array<ArrayBuffer> {
  if (!secret.startsWith(SECRET_PREFIX)) return utf8(secret);
  const key = decodeBase64(secret.slice(SECRET_PREFIX.length));
  if (!key || key.length === 0) {
    throw new WebhookVerificationError(
      "INVALID_SECRET",
      "A secret that starts with `whsec_` must continue with a base64 key. Copy the whole secret from the sender.",
    );
  }
  return key;
}

export function hmacKey(
  key: Uint8Array<ArrayBuffer>,
  usage: "sign" | "verify",
): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** True when `signature` is the HMAC-SHA256 of `content` with any secret. Constant-time. */
export async function matchesAnySecret(
  secrets: readonly Uint8Array<ArrayBuffer>[],
  signatures: readonly Uint8Array<ArrayBuffer>[],
  content: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  for (const secret of secrets) {
    const key = await hmacKey(secret, "verify");
    for (const signature of signatures) {
      if (await crypto.subtle.verify("HMAC", key, signature, content)) return true;
    }
  }
  return false;
}
