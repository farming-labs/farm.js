import {
  integrationRoute,
  invalidate,
  revalidatePath,
  type FarmIntegrationRoute,
  type RouteDataCacheKey,
} from "@farm.js/core";
import {
  DEFAULT_STRAPI_WEBHOOK_PATH,
  DEFAULT_STRAPI_WEBHOOK_SECRET_HEADER,
  type StrapiWebhookChange,
  type StrapiWebhookOptions,
} from "./config.js";

export interface StrapiWebhookInvalidation {
  invalidate(key: RouteDataCacheKey): void | Promise<void>;
  revalidatePath(path: string): void | Promise<void>;
}

const farmInvalidation: StrapiWebhookInvalidation = { invalidate, revalidatePath };

export interface StrapiWebhookRouteOptions extends Omit<StrapiWebhookOptions, "secret"> {
  secret: string;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function secretsEqual(expected: string, received: string): Promise<boolean> {
  const encoded = new TextEncoder();
  const [expectedDigest, receivedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoded.encode(expected)),
    crypto.subtle.digest("SHA-256", encoded.encode(received)),
  ]);
  const left = new Uint8Array(expectedDigest);
  const right = new Uint8Array(receivedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function applyStrapiWebhookChange(
  change: StrapiWebhookChange | void,
  invalidation: StrapiWebhookInvalidation = farmInvalidation,
): Promise<number> {
  if (!change) return 0;
  const keys = [...new Map((change.keys ?? []).map((key) => [JSON.stringify(key), key])).values()];
  const paths = [...new Set(change.paths ?? [])];
  await Promise.all([
    ...keys.map((key) => invalidation.invalidate(key)),
    ...paths.map((path) => invalidation.revalidatePath(path)),
  ]);
  return keys.length + paths.length;
}

export function createStrapiWebhookRoute(
  options: StrapiWebhookRouteOptions,
  invalidation: StrapiWebhookInvalidation = farmInvalidation,
): FarmIntegrationRoute {
  if (!options.secret) throw new TypeError("Strapi webhook requires a non-empty secret");
  const secretHeader = options.secretHeader ?? DEFAULT_STRAPI_WEBHOOK_SECRET_HEADER;
  try {
    new Headers({ [secretHeader]: "validate" });
  } catch {
    throw new TypeError("Strapi webhook secretHeader must be a valid HTTP header name");
  }

  return integrationRoute.post(options.path ?? DEFAULT_STRAPI_WEBHOOK_PATH, {
    async handler(request) {
      const presentedSecret = request.headers.get(secretHeader);
      if (!presentedSecret || !(await secretsEqual(options.secret, presentedSecret))) {
        return json(401, { error: "Invalid webhook secret" });
      }

      let payload: Record<string, unknown>;
      try {
        const value: unknown = await request.json();
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return json(400, { error: "Body must be a JSON object" });
        }
        payload = value as Record<string, unknown>;
      } catch {
        return json(400, { error: "Body is not JSON" });
      }

      try {
        const change = await options.onChange(payload);
        const targets = await applyStrapiWebhookChange(change, invalidation);
        return json(200, { targets });
      } catch {
        // A mapping or cache failure should be visible to the webhook sender,
        // without reflecting application errors or credentials in the body.
        return json(500, { error: "Failed to apply change" });
      }
    },
  });
}
