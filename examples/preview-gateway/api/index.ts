import {
  createNodePreviewGatewayHandler,
  type PreviewGatewayRequest,
  type PreviewGatewayResponse,
  type PreviewGatewaySession,
  type PreviewGatewayStore,
} from "@farmjs/preview-gateway";
import { del, get, list, put } from "@vercel/blob";

interface ExpiringValue<T> {
  expiresAt: number;
  value: T;
}

const BLOB_PREFIX = "farm-preview";
const BLOB_ACCESS = "private";

class VercelBlobPreviewGatewayStore implements PreviewGatewayStore {
  async createSession(session: PreviewGatewaySession, ttlMs: number): Promise<void> {
    await Promise.all([
      this.write(this.sessionKey(session.id), session, ttlMs),
      this.write(this.nameKey(session.name), session.id, ttlMs),
    ]);
  }

  async getSessionByName(name: string): Promise<PreviewGatewaySession | undefined> {
    const id = await this.read<string>(this.nameKey(name));
    return id ? this.getSessionById(id) : undefined;
  }

  async getSessionById(id: string): Promise<PreviewGatewaySession | undefined> {
    return await this.read<PreviewGatewaySession>(this.sessionKey(id));
  }

  async touchSession(session: PreviewGatewaySession, ttlMs: number): Promise<void> {
    const nextSession = {
      ...session,
      expiresAt: Date.now() + ttlMs,
    };
    await Promise.all([
      this.write(this.sessionKey(session.id), nextSession, ttlMs),
      this.write(this.nameKey(session.name), session.id, ttlMs),
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
    await Promise.all([
      this.deletePath(this.sessionKey(session.id)),
      this.deletePath(this.nameKey(session.name)),
      this.deletePrefix(this.queuePrefix(session.id)),
      this.deletePrefix(this.responsesPrefix(session.id)),
    ]);
  }

  private async write<T>(pathname: string, value: T, ttlMs: number) {
    const payload: ExpiringValue<T> = {
      expiresAt: Date.now() + ttlMs,
      value,
    };
    await put(pathname, JSON.stringify(payload), {
      access: BLOB_ACCESS,
      allowOverwrite: true,
      contentType: "application/json",
    });
  }

  private async read<T>(pathname: string): Promise<T | undefined> {
    const blob = await get(pathname, {
      access: BLOB_ACCESS,
      useCache: false,
    }).catch((error: unknown) => {
      if (isMissingBlobError(error)) return null;
      throw error;
    });
    if (!blob || blob.statusCode !== 200 || !blob.stream) return undefined;

    const payload = JSON.parse(await new Response(blob.stream).text()) as ExpiringValue<T>;
    if (payload.expiresAt <= Date.now()) {
      await this.deletePath(pathname);
      return undefined;
    }
    return payload.value;
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

function isMissingBlobError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "BlobNotFoundError" ||
    error.message.includes("404") ||
    error.message.includes("400 Bad Request")
  );
}

export const config = {
  maxDuration: 60,
};

export default createNodePreviewGatewayHandler({
  domain: process.env.FARM_PREVIEW_DOMAIN || "preview.farming-labs.dev",
  baseUrl: process.env.FARM_PREVIEW_GATEWAY_URL,
  clientHeartbeatTimeoutMs: 1000 * 60 * 30,
  store: createVercelBlobStore(),
});
