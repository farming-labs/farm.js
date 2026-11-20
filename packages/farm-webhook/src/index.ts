import { defineIntegration, integrationRoute } from "@farm.js/core";
import { verifyWebhook } from "@farm.js/webhooks";
import { isSigningSecret } from "./signing-secret.js";

export { createWebhook, createWebhookSender, registerWebhook } from "./sender.js";

interface Receiver {
  path: string;
  secret: string | undefined;
  onEvent(event: { id: string; data: unknown }): Promise<void> | void;
}

/** Mount raw POST routes for deliveries signed by Farm Infra. */
export function webhooks(receivers: Record<string, Receiver>) {
  const paths = new Set<string>();
  const secrets = new Set<string>();
  const routes = Object.entries(receivers).map(([name, receiver]) => {
    if (!isSigningSecret(receiver.secret) || secrets.has(receiver.secret))
      throw new TypeError(`Configure a distinct receiver signing secret for "${name}".`);
    if (!/^\/(?:[\w-]+\/)*[\w-]+$/.test(receiver.path) || paths.has(receiver.path))
      throw new TypeError(`Configure a unique absolute route path for "${name}".`);
    paths.add(receiver.path);
    secrets.add(receiver.secret);
    const secret = receiver.secret;
    return integrationRoute.post(receiver.path, {
      rawBody: true,
      async handler(request) {
        if (!request.body) return new Response(null, { status: 400 });
        const deadline = AbortSignal.timeout(5000);
        const reader = request.body
          .pipeThrough(new TransformStream(), { signal: deadline })
          .getReader();
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 256 * 1024) {
              await reader.cancel();
              return new Response(null, { status: 413 });
            }
            chunks.push(value);
          }
        } catch {
          return new Response(null, { status: deadline.aborted ? 408 : 400 });
        } finally {
          reader.releaseLock();
        }
        let event;
        try {
          const body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            Buffer.concat(chunks),
          );
          event = await verifyWebhook({ body, headers: request.headers }, { secret });
        } catch {
          return new Response(null, { status: 403 });
        }
        await receiver.onEvent({ id: event.id, data: event.payload });
        return new Response(null, { status: 204 });
      },
    });
  });
  return defineIntegration({ category: "webhooks", type: "inbox", instance: {}, routes });
}
