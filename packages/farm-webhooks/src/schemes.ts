import {
  decodeBase64,
  matchesAnySecret,
  secretKeyBytes,
  utf8,
  WebhookVerificationError,
  type WebhookScheme,
} from "./shared.js";

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function missing(names: string[]): WebhookVerificationError {
  return new WebhookVerificationError(
    "MISSING_HEADERS",
    `The webhook is missing ${names.map((name) => `\`${name}\``).join(", ")}. Check that the sender signs its webhooks and that \`scheme\` matches it.`,
  );
}

/**
 * Standard Webhooks (standardwebhooks.com): `webhook-id`, `webhook-timestamp` and
 * `webhook-signature: v1,<base64>`, the HMAC-SHA256 of `{id}.{timestamp}.{body}`. Svix's
 * `svix-*` headers are the same scheme and are accepted too, so this verifies Clerk, Resend,
 * Autumn and other Svix-based senders.
 */
export function standardWebhooks(): WebhookScheme {
  return {
    name: "standard-webhooks",
    async verify({ body, headers, secrets, toleranceSeconds, now }) {
      const read = (name: string) => headers.get(`webhook-${name}`) ?? headers.get(`svix-${name}`);
      const id = read("id");
      const timestamp = read("timestamp");
      const signature = read("signature");
      if (!id || !timestamp || !signature) {
        throw missing(
          [
            id ? undefined : "webhook-id",
            timestamp ? undefined : "webhook-timestamp",
            signature ? undefined : "webhook-signature",
          ].filter((name): name is string => name !== undefined),
        );
      }
      if (!/^\d{1,12}$/.test(timestamp)) {
        throw new WebhookVerificationError(
          "INVALID_TIMESTAMP",
          "`webhook-timestamp` must be the Unix time in seconds.",
        );
      }
      const seconds = Number(timestamp);
      if (Math.abs(now / 1000 - seconds) > toleranceSeconds) {
        throw new WebhookVerificationError(
          "TIMESTAMP_OUT_OF_RANGE",
          `The webhook was signed more than ${toleranceSeconds} seconds from now, so it may be a replay. Check the server's clock, or raise \`toleranceSeconds\`.`,
        );
      }

      // Space-separated `version,signature` pairs. Only v1 (HMAC) is checked; others are skipped.
      const signatures = signature
        .split(" ")
        .map((entry) => entry.split(","))
        .filter(([version, value]) => version === "v1" && value)
        .map(([, value]) => decodeBase64(value!))
        .filter((value): value is Uint8Array<ArrayBuffer> => value !== undefined);
      const content = concat(utf8(`${id}.${timestamp}.`), body);
      if (!(await matchesAnySecret(secrets.map(secretKeyBytes), signatures, content))) {
        throw new WebhookVerificationError(
          "INVALID_SIGNATURE",
          "The webhook's signature doesn't match `secret`. Check that it's this endpoint's secret and that the body reached you unchanged.",
        );
      }
      return { id, timestamp: new Date(seconds * 1000) };
    },
  };
}

/**
 * GitHub's scheme: `x-hub-signature-256: sha256=<hex>`, the HMAC-SHA256 of the body with the
 * secret's UTF-8 bytes. GitHub signs no timestamp, so dedupe on `id` (`x-github-delivery`) to
 * drop a replayed delivery. `type` is `x-github-event`.
 */
export function github(): WebhookScheme {
  return {
    name: "github",
    async verify({ body, headers, secrets }) {
      const id = headers.get("x-github-delivery");
      const signature = headers.get("x-hub-signature-256");
      if (!id || !signature) {
        throw missing(
          [
            id ? undefined : "x-github-delivery",
            signature ? undefined : "x-hub-signature-256",
          ].filter((name): name is string => name !== undefined),
        );
      }
      const hex = /^sha256=([0-9a-f]{64})$/i.exec(signature)?.[1];
      const bytes = hex
        ? Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16))
        : undefined;
      const keys = secrets.map((secret) => utf8(secret));
      if (!bytes || !(await matchesAnySecret(keys, [bytes], concat(body)))) {
        throw new WebhookVerificationError(
          "INVALID_SIGNATURE",
          "The webhook's `x-hub-signature-256` doesn't match `secret`. Check that it's the secret set on the GitHub webhook.",
        );
      }
      return { id, type: headers.get("x-github-event") ?? undefined };
    },
  };
}
