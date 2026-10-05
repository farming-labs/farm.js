import { randomUUID } from "node:crypto";
import type { PreviewManagedAuthOptions, PreviewGatewayObserver } from "@farm.js/preview-gateway";

/** Private backchannel; account credentials are used only for verification. */
export function createInfraPreviewIntegration(
  env: Record<string, string | undefined>,
  request: typeof fetch = fetch,
  waitUntil: (promise: Promise<unknown>) => void = () => {},
) {
  if (!env.FARM_INFRA_URL) return undefined;
  const url = new URL(env.FARM_INFRA_URL);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "FARM_INFRA_URL must be an HTTPS origin (or a loopback HTTP origin for development).",
    );
  }
  const secret = env.FARM_PREVIEW_GATEWAY_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32)
    throw new Error(
      "FARM_PREVIEW_GATEWAY_SECRET must contain at least 32 bytes and match Farm Infra.",
    );
  const headers = { "content-type": "application/json", "x-farm-gateway-token": secret };
  const deviceAuth: NonNullable<PreviewManagedAuthOptions["deviceAuth"]> = {
    issuer: `${url.origin}/api/auth`,
    clientId: "farm-preview",
    async authorizeAccount(token) {
      const response = await request(`${url.origin}/api/previews/identity`, {
        method: "POST",
        headers: { ...headers, authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) return null;
        throw new Error("Farm Infra authentication unavailable.");
      }
      return response.json();
    },
  };
  // Bound optional telemetry work. Dropped events must not block app traffic.
  const queues = new Map<string, Promise<void>>();
  let pending = 0;
  function send(sessionId: string, payload: object) {
    if (pending >= 64) return;
    pending++;
    const previous = queues.get(sessionId) ?? Promise.resolve();
    const work = previous
      .then(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = await request(`${url.origin}/api/previews/events`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(1500),
            redirect: "error",
          });
          await response.body?.cancel();
          if (response.ok) return;
          if (response.status !== 409 && response.status < 500) break;
          // The session-created event may still be arriving from another relay instance.
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
        }
        throw new Error("Preview activity delivery failed.");
      })
      .catch(() => {
        // Do not log the payload, URLs, headers or credential-bearing request.
        console.warn("Farm Infra preview activity could not be delivered.");
      })
      .finally(() => {
        pending--;
        if (queues.get(sessionId) === work) queues.delete(sessionId);
      });
    queues.set(sessionId, work);
    waitUntil(work);
  }
  function observer(transport: "websocket" | "polling"): PreviewGatewayObserver {
    const lastSeen = new Map<string, number>();
    return {
      session(event) {
        if (!event.ownerId?.startsWith("device:") || !event.expiresAt) return;
        if (event.state === "connected" && event.at - (lastSeen.get(event.id) ?? 0) < 20_000)
          return;
        if (event.state === "disconnected") lastSeen.delete(event.id);
        else {
          if (lastSeen.size >= 10_000) lastSeen.delete(lastSeen.keys().next().value!);
          lastSeen.set(event.id, event.at);
        }
        send(event.id, {
          type: "session",
          ...event,
          userId: event.ownerId.slice(7),
          ownerId: undefined,
          transport,
        });
      },
      request(event) {
        send(event.sessionId, { type: "request", id: randomUUID(), ...event });
      },
    };
  }
  return { deviceAuth, dashboardUrl: `${url.origin}/dashboard/previews`, observer };
}
