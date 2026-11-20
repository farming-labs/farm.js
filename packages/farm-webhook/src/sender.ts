import { isSigningSecret } from "./signing-secret.js";

type Verification =
  | { mode: "bearer"; deliverySecret: string }
  | { mode: "preserve"; signatureHeaders: string[] }
  | { mode: "standard"; sourceSecret: string; deliverySecret: string };

function secureUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new TypeError("Use an HTTPS URL without credentials, search or fragment.");
  return url;
}
async function post(url: URL, key: string, body?: string, headers?: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body,
  });
  if (!response.ok) throw new Error(`Farm webhook request failed (HTTP ${response.status}).`);
  return response.json();
}

interface Registration {
  apiKey: string;
  project: string;
  environment: "development" | "staging" | "production";
  name: string;
  destination: string;
  verification: Verification;
  infraOrigin?: string;
}

interface ReceiverCredentials {
  url: string;
  sendKey: string;
  auth?: "token" | "direct";
}

type NamedSender = Omit<Registration, "verification"> & {
  verification: Extract<Verification, { mode: "bearer" }>;
};
type Access = { url: URL; token: string; expiresAt: number };

function registrationUrl(config: Registration) {
  if (!config.apiKey?.trim()) throw new TypeError("Set apiKey to a project API key.");
  if (!config.project?.trim()) throw new TypeError("Set project to the receiving project ID.");
  if (!["development", "staging", "production"].includes(config.environment))
    throw new TypeError("Set environment to development, staging or production.");
  if (typeof config.name !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(config.name))
    throw new TypeError("Set name to a lowercase receiver name of 1 to 63 characters.");
  secureUrl(config.destination);
  const verification = config.verification;
  if (verification.mode !== "preserve" && !isSigningSecret(verification.deliverySecret))
    throw new TypeError("Set deliverySecret to the receiver's Standard Webhooks signing secret.");
  if (
    verification.mode === "standard" &&
    (!isSigningSecret(verification.sourceSecret) ||
      verification.sourceSecret === verification.deliverySecret)
  )
    throw new TypeError(
      "Set sourceSecret to the sender's separate Standard Webhooks signing secret.",
    );
  return new URL("/api/inbox/receivers", secureUrl(config.infraOrigin ?? "https://app.farmjs.dev"));
}
function register(config: Registration, url: URL) {
  return post(
    url,
    config.apiKey,
    JSON.stringify({ name: config.name, destination: config.destination, ...config.verification }),
    { "x-farm-project": config.project, "x-farm-environment": config.environment },
  );
}

/** Explicit provisioning for deployment tools and provider-signed receivers. */
export function registerWebhook(
  config: Registration,
): Promise<{ id: string; url: string; sendKey?: string }> {
  return register(config, registrationUrl(config));
}

/** Construct locally. The first send resolves the receiver and obtains its credential. */
export function createWebhook(options: ReceiverCredentials | NamedSender) {
  let access: Access | undefined;
  let pending: Promise<Access> | undefined;
  let obtain: () => Promise<Access>;
  if ("url" in options) {
    const url = secureUrl(options.url);
    if (!/^fws_[\w-]{43}$/.test(options.sendKey))
      throw new TypeError("Supply the receiver's write-only send key.");
    if (options.auth !== undefined && options.auth !== "token" && options.auth !== "direct")
      throw new TypeError("Choose direct or token authentication.");
    if (options.auth === "direct") access = { url, token: options.sendKey, expiresAt: Infinity };
    const tokenUrl = new URL(url.href.replace(/\/$/, "") + "/token");
    obtain = async () => tokenAccess(url, await post(tokenUrl, options.sendKey));
  } else {
    const endpoint = registrationUrl(options);
    endpoint.searchParams.set("intent", "send");
    obtain = async () => {
      const result = await register(options, endpoint);
      const url = secureUrl(result.url);
      if (url.origin !== endpoint.origin)
        throw new Error("Receiver URL does not match the configured Infra origin.");
      return tokenAccess(url, result);
    };
  }
  return {
    async send(
      data: unknown,
      { idempotencyKey }: { idempotencyKey?: string } = {},
    ): Promise<{ id: string }> {
      const body = JSON.stringify(data);
      if (body === undefined) throw new TypeError("Send a serializable JSON value.");
      if (!access || access.expiresAt <= Date.now() + 30_000) {
        pending ??= obtain().finally(() => {
          pending = undefined;
        });
        access = await pending;
      }
      return post(
        access.url,
        access.token,
        body,
        idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined,
      );
    },
  };
}
function tokenAccess(url: URL, response: { token: string; expiresAt: string }): Access {
  const expiresAt = Date.parse(response.expiresAt);
  if (
    typeof response.token !== "string" ||
    !response.token ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  )
    throw new Error("Infra returned an invalid sender token.");
  return { url, token: response.token, expiresAt };
}

export function createWebhookSender(options: ReceiverCredentials) {
  return createWebhook(options);
}
