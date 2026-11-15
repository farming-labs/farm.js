import {
  createNodePreviewGatewayHandler,
  verifyPreviewTunnelGrant,
  type PreviewGatewayCreateSessionOptions,
  type PreviewManagedAuthOptions,
  type PreviewGatewayRequest,
  type PreviewGatewayResponse,
  type PreviewGatewaySession,
  type PreviewGatewayStore,
} from "@farm.js/preview-gateway";
import { createPersistentPreviewRelay } from "@farm.js/preview-tunnel";
import { waitUntil } from "@vercel/functions";
import { createInfraPreviewIntegration } from "../lib/infra.js";
import { BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";

import { createRedisPreviewAuthExchangeRateLimiter } from "../lib/redis-auth-rate-limiter.js";
import { createRedisPreviewRelayCoordinator } from "../lib/redis-coordinator.js";

interface ExpiringValue<T> {
  expiresAt: number;
  value: T;
}

const BLOB_PREFIX = "farm-preview";
const BLOB_ACCESS = "private";

class VercelBlobPreviewGatewayStore implements PreviewGatewayStore {
  async createSession(
    session: PreviewGatewaySession,
    ttlMs: number,
    options: PreviewGatewayCreateSessionOptions = {},
  ): Promise<boolean> {
    // The session record is written before the name is claimed, so a name
    // that points at a missing session always belongs to a dead one.
    await this.write(this.sessionKey(session.id), session, ttlMs);
    const claimed = await this.claimName(session, ttlMs, async (owner) => {
      if (owner === session.id || owner === options.replaceSessionId) return true;
      return !(await this.getSessionById(owner));
    });
    if (!claimed) await this.deletePath(this.sessionKey(session.id));
    return claimed;
  }

  async reserveName(name: string, ownerId: string, ttlMs: number): Promise<void> {
    await this.write(this.reservationKey(name), ownerId, ttlMs);
  }

  async getNameReservation(name: string): Promise<string | undefined> {
    return await this.read<string>(this.reservationKey(name));
  }

  async getSessionByName(name: string): Promise<PreviewGatewaySession | undefined> {
    const id = await this.read<string>(this.nameKey(name));
    return id ? this.getSessionById(id) : undefined;
  }

  async getSessionById(id: string): Promise<PreviewGatewaySession | undefined> {
    return await this.read<PreviewGatewaySession>(this.sessionKey(id));
  }

  async touchSession(session: PreviewGatewaySession, ttlMs: number): Promise<void> {
    const nextSession = { ...session };
    const remainingTtlMs = Math.max(1, Math.min(ttlMs, session.expiresAt - Date.now()));
    await Promise.all([
      this.write(this.sessionKey(session.id), nextSession, remainingTtlMs),
      // Only refresh a name this session still owns: a late poll from a
      // replaced session must not take the name back.
      this.claimName(session, remainingTtlMs, async (owner) => owner === session.id),
    ]);
  }

  async enqueueRequest(
    sessionId: string,
    request: PreviewGatewayRequest,
    ttlMs: number,
  ): Promise<void> {
    await this.write(this.requestKey(sessionId, request), request, ttlMs);
  }

  async takeRequests(sessionId: string, limit: number): Promise<PreviewGatewayRequest[]> {
    const prefix = this.queuePrefix(sessionId);
    const values: PreviewGatewayRequest[] = [];
    let cursor: string | undefined;

    while (values.length < limit) {
      const result = await list({
        prefix,
        cursor,
        limit: Math.max(limit * 4, 24),
      });
      const blobs = [...result.blobs].sort((a, b) => a.pathname.localeCompare(b.pathname));

      for (const blob of blobs) {
        if (values.length >= limit) break;

        const request = await this.read<PreviewGatewayRequest>(blob.pathname);
        await this.deletePath(blob.pathname);

        if (request) {
          values.push(request);
        }
      }

      if (!result.hasMore || !result.cursor) break;
      cursor = result.cursor;
    }

    return values;
  }

  async saveResponse(
    sessionId: string,
    requestId: string,
    response: PreviewGatewayResponse,
    ttlMs: number,
  ): Promise<void> {
    await this.write(this.responseKey(sessionId, requestId), response, ttlMs);
  }

  async getResponse(
    sessionId: string,
    requestId: string,
  ): Promise<PreviewGatewayResponse | undefined> {
    return await this.read<PreviewGatewayResponse>(this.responseKey(sessionId, requestId));
  }

  async deleteResponse(sessionId: string, requestId: string): Promise<void> {
    await this.deletePath(this.responseKey(sessionId, requestId));
  }

  async deleteSession(session: PreviewGatewaySession): Promise<void> {
    // The name may have been taken over by a newer session; only remove the
    // mapping if it still points at the session being deleted.
    const owner = await this.readEntry<string>(this.nameKey(session.name));
    await Promise.all([
      this.deletePath(this.sessionKey(session.id)),
      owner?.value === session.id ? this.deletePath(this.nameKey(session.name)) : undefined,
      this.deletePrefix(this.queuePrefix(session.id)),
      this.deletePrefix(this.responsesPrefix(session.id)),
    ]);
  }

  /**
   * Claims a session's name with a compare-and-swap on the name blob's ETag
   * (or a create-only write when there is none), so two concurrent claims
   * cannot both win. An expired name is always free.
   */
  private async claimName(
    session: PreviewGatewaySession,
    ttlMs: number,
    canReplace: (owner: string) => Promise<boolean>,
  ): Promise<boolean> {
    const current = await this.readEntry<string>(this.nameKey(session.name));
    if (current && !current.expired && !(await canReplace(current.value))) return false;
    try {
      await this.write(
        this.nameKey(session.name),
        session.id,
        ttlMs,
        current ? { ifMatch: current.etag } : { allowOverwrite: false },
      );
      return true;
    } catch (error) {
      if (isBlobWriteConflict(error)) return false;
      throw error;
    }
  }

  private async write<T>(
    pathname: string,
    value: T,
    ttlMs: number,
    condition: { ifMatch?: string; allowOverwrite?: boolean } = {},
  ) {
    const payload: ExpiringValue<T> = {
      expiresAt: Date.now() + ttlMs,
      value,
    };
    await put(pathname, JSON.stringify(payload), {
      access: BLOB_ACCESS,
      allowOverwrite: true,
      contentType: "application/json",
      ...condition,
    });
  }

  private async read<T>(pathname: string): Promise<T | undefined> {
    const entry = await this.readEntry<T>(pathname);
    if (!entry) return undefined;
    if (entry.expired) {
      await this.deletePath(pathname);
      return undefined;
    }
    return entry.value;
  }

  private async readEntry<T>(
    pathname: string,
  ): Promise<{ value: T; etag: string; expired: boolean } | undefined> {
    const blob = await get(pathname, {
      access: BLOB_ACCESS,
      useCache: false,
    }).catch((error: unknown) => {
      if (isMissingBlobError(error)) return null;
      throw error;
    });
    if (!blob || blob.statusCode !== 200 || !blob.stream) return undefined;

    const payload = JSON.parse(await new Response(blob.stream).text()) as ExpiringValue<T>;
    return {
      value: payload.value,
      etag: blob.blob.etag,
      expired: payload.expiresAt <= Date.now(),
    };
  }

  private async deletePath(pathname: string) {
    await del(pathname).catch(() => undefined);
  }

  private async deletePrefix(prefix: string) {
    let cursor: string | undefined;
    do {
      const result = await list({ prefix, cursor, limit: 1000 });
      if (result.blobs.length) {
        await del(result.blobs.map((blob) => blob.pathname)).catch(() => undefined);
      }
      cursor = result.cursor;
      if (!result.hasMore) break;
    } while (cursor);
  }

  private key(path: string) {
    return `${BLOB_PREFIX}/${path}`;
  }

  private reservationKey(name: string) {
    return this.key(`reserved/${name}.json`);
  }

  private sessionKey(id: string) {
    return this.key(`sessions/${id}.json`);
  }

  private nameKey(name: string) {
    return this.key(`names/${name}.json`);
  }

  private queuePrefix(sessionId: string) {
    return this.key(`queues/${sessionId}/`);
  }

  private requestKey(sessionId: string, request: PreviewGatewayRequest) {
    return `${this.queuePrefix(sessionId)}${request.createdAt}-${request.id}.json`;
  }

  private responsesPrefix(sessionId: string) {
    return this.key(`responses/${sessionId}/`);
  }

  private responseKey(sessionId: string, requestId: string) {
    return `${this.responsesPrefix(sessionId)}${requestId}.json`;
  }
}

function createVercelBlobStore() {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return undefined;
  return new VercelBlobPreviewGatewayStore();
}

function isBlobWriteConflict(error: unknown) {
  return (
    error instanceof BlobPreconditionFailedError ||
    (error instanceof Error && /already exists/i.test(error.message))
  );
}

function isMissingBlobError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "BlobNotFoundError" ||
    error.message.includes("404") ||
    error.message.includes("400 Bad Request")
  );
}

export const config = {
  maxDuration: 1800,
};

const domain = process.env.FARM_PREVIEW_DOMAIN || "preview.farmjs.dev";
const coordinator = createRedisPreviewRelayCoordinator();
// Managed sign-in is Farm.js Infrastructure: developers sign in there and preview with an API key.
const infra = process.env.FARM_PREVIEW_AUTH_SECRET
  ? createInfraPreviewIntegration(process.env, fetch, waitUntil)
  : undefined;
const auth = createManagedPreviewAuth();
const pollingGateway = createNodePreviewGatewayHandler({
  domain,
  baseUrl: process.env.FARM_PREVIEW_GATEWAY_URL,
  clientHeartbeatTimeoutMs: 1000 * 60 * 30,
  store: createVercelBlobStore(),
  auth,
  observer: infra?.observer("polling"),
  authorizeSession: infra?.authorizeSession,
  // The relay route wins over polling for the same hostname, so a name the
  // relay serves (or keeps reserved for another account) gets no polling
  // session or grant. Called per request, after the relay below exists.
  isPreviewNameClaimed: (name, ownerId) => persistentRelay.isPreviewNameClaimed(name, ownerId),
});

const persistentRelay = createPersistentPreviewRelay({
  observer: infra?.observer("websocket"),
  authorizeSession: infra?.authorizeSession,
  publicBaseUrl: process.env.FARM_PREVIEW_GATEWAY_URL || `https://${domain}`,
  publicDomain: domain,
  publicWebSocketUrl: `wss://${domain}/agent`,
  healthPath: "/api/tunnel/health",
  fallbackHandler: pollingGateway,
  coordinator,
  // This handler is the public entry point for the whole gateway domain, so an
  // unauthenticated /agent registration would let anyone claim a preview
  // hostname. Managed deployments require a name-bound tunnel grant. A
  // self-hosted legacy deployment can instead opt into one shared relay token;
  // with neither configured the relay accepts no registrations.
  ...(auth
    ? {
        authorizeAgent: ({ token, name }: { token: string; name: string }) => {
          try {
            const grant = verifyPreviewTunnelGrant(token, {
              signingSecret: auth.signingSecret,
              name,
            });
            return {
              expiresAt: grant.expiresAt,
              ownerId: `${grant.provider || "github"}:${grant.subject}`,
              project: grant.project ?? grant.name,
              keyId: grant.keyId,
              grantId: grant.nonce,
            };
          } catch {
            return false;
          }
        },
      }
    : { registrationToken: process.env.FARM_PREVIEW_RELAY_TOKEN }),
  // A relay route wins over the polling fallback, so a name a live polling
  // session owns must not be claimable over the WebSocket transport.
  isPreviewNameClaimed: pollingGateway.isPreviewNameClaimed,
});

function createManagedPreviewAuth(): PreviewManagedAuthOptions | undefined {
  const signingSecret = process.env.FARM_PREVIEW_AUTH_SECRET;
  if (!signingSecret || !infra) return undefined;
  const rateLimitExchange = createRedisPreviewAuthExchangeRateLimiter();
  if (!rateLimitExchange && process.env.VERCEL_ENV === "production") {
    throw new Error(
      "Managed preview auth requires REDIS_URL, KV_URL, or UPSTASH_REDIS_URL for shared exchange rate limiting.",
    );
  }
  return {
    signingSecret,
    deviceAuth: infra.deviceAuth,
    dashboardUrl: infra.dashboardUrl,
    rateLimitExchange,
    defaultSessionTtlMs: readDuration("FARM_PREVIEW_DEFAULT_TTL_MS", 1000 * 60 * 60),
    maxSessionTtlMs: readDuration("FARM_PREVIEW_MAX_TTL_MS", 1000 * 60 * 60 * 24),
  };
}

function readDuration(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export default persistentRelay.server;
