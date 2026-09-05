import {
  integrationRoute,
  invalidate,
  revalidatePath,
  type FarmIntegrationRoute,
  type RouteDataCacheKey,
} from "@farm.js/core";
import { isValidSignature, SIGNATURE_HEADER_NAME } from "@sanity/webhook";
import type { SanityWebhookChange, SanityWebhookOptions } from "./config.js";

export const DEFAULT_SANITY_WEBHOOK_PATH = "/api/sanity/webhook";

/** The cache operations the route performs. Injected so tests need no cache. */
export interface SanityWebhookInvalidation {
  invalidate(key: RouteDataCacheKey): void | Promise<void>;
  revalidatePath(path: string): void | Promise<void>;
}

const farmInvalidation: SanityWebhookInvalidation = { invalidate, revalidatePath };

export interface SanityWebhookRouteOptions extends Omit<SanityWebhookOptions, "secret"> {
  secret: string;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function applySanityWebhookChange(
  change: SanityWebhookChange | void,
  invalidation: SanityWebhookInvalidation = farmInvalidation,
): Promise<number> {
  if (!change) return 0;
  const keys = change.keys ?? [];
  const paths = change.paths ?? [];
  await Promise.all([
    ...keys.map((key) => invalidation.invalidate(key)),
    ...paths.map((path) => invalidation.revalidatePath(path)),
  ]);
  return keys.length + paths.length;
}

export function createSanityWebhookRoute(
  options: SanityWebhookRouteOptions,
  invalidation: SanityWebhookInvalidation = farmInvalidation,
): FarmIntegrationRoute {
  return integrationRoute.post(options.path ?? DEFAULT_SANITY_WEBHOOK_PATH, {
    // Sanity signs the exact bytes it sent. Parsing first and re-serialising
    // changes them, so the body has to be read as text and verified before
    // anything looks at it.
    rawBody: true,
    async handler(request) {
      const rawBody = await request.text();
      const signature = request.headers.get(SIGNATURE_HEADER_NAME);

      if (!signature || !(await isValidSignature(rawBody, signature, options.secret))) {
        return json(401, { error: "Invalid signature" });
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return json(400, { error: "Body is not JSON" });
      }

      // Sanity retries on 5xx and gives up on 4xx. A failing mapping is the
      // app's problem, not the payload's, so it should be retried.
      try {
        const change = await options.onChange(payload);
        const invalidated = await applySanityWebhookChange(change, invalidation);
        return json(200, { invalidated });
      } catch {
        return json(500, { error: "Failed to apply change" });
      }
    },
  });
}
