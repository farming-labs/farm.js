import {
  isAgentToRelayMessage,
  isRelayToAgentMessage,
  type PersistentPreviewRelayCoordinator,
  type PersistentPreviewRelayCoordinatorSession,
  type TunnelRequestMessage,
  type TunnelResponseMessage,
} from "@farm.js/preview-tunnel";
import Redis from "ioredis";

const KEY_PREFIX = "farm-preview:native";
const QUEUE_TTL_MS = 60_000;

const TOUCH_SESSION_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end
  return 0
`;

const RELEASE_SESSION_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

export class RedisPreviewRelayCoordinator implements PersistentPreviewRelayCoordinator {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, {
      connectionName: "farm-preview-relay",
      connectTimeout: 5_000,
      enableReadyCheck: true,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    this.redis.on("error", () => undefined);
  }

  async claimSession(session: PersistentPreviewRelayCoordinatorSession, ttlMs: number) {
    const result = await this.redis.set(this.nameKey(session.name), session.id, "PX", ttlMs, "NX");
    return result === "OK";
  }

  async findSession(name: string) {
    const id = await this.redis.get(this.nameKey(name));
    return id ? { id, name } : undefined;
  }

  async touchSession(session: PersistentPreviewRelayCoordinatorSession, ttlMs: number) {
    const result = await this.redis.eval(
      TOUCH_SESSION_SCRIPT,
      1,
      this.nameKey(session.name),
      session.id,
      ttlMs,
    );
    return Number(result) === 1;
  }

  async releaseSession(session: PersistentPreviewRelayCoordinatorSession) {
    await this.redis.eval(RELEASE_SESSION_SCRIPT, 1, this.nameKey(session.name), session.id);
  }

  async publishRequest(sessionId: string, request: TunnelRequestMessage) {
    await this.push(this.requestKey(sessionId), request);
  }

  async takeRequest(sessionId: string, timeoutMs: number) {
    const value = await this.take(this.requestKey(sessionId), timeoutMs);
    if (!value) return undefined;
    const message: unknown = JSON.parse(value);
    return isRelayToAgentMessage(message) && message.type === "request" ? message : undefined;
  }

  async publishResponse(sessionId: string, response: TunnelResponseMessage) {
    await this.push(this.responseKey(sessionId, response.id), response);
  }

  async takeResponse(sessionId: string, requestId: string, timeoutMs: number) {
    const value = await this.take(this.responseKey(sessionId, requestId), timeoutMs);
    if (!value) return undefined;
    const message: unknown = JSON.parse(value);
    return isAgentToRelayMessage(message) && message.type === "response" ? message : undefined;
  }

  private async push(key: string, value: unknown) {
    await this.redis
      .multi()
      .rpush(key, JSON.stringify(value))
      .pexpire(key, QUEUE_TTL_MS)
      .exec();
  }

  private async take(key: string, timeoutMs: number) {
    const blocker = this.redis.duplicate({ maxRetriesPerRequest: null });
    blocker.on("error", () => undefined);
    try {
      const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1_000));
      const result = await blocker.blpop(key, timeoutSeconds);
      return result?.[1];
    } finally {
      blocker.disconnect();
    }
  }

  private nameKey(name: string) {
    return `${KEY_PREFIX}:names:${name}`;
  }

  private requestKey(sessionId: string) {
    return `${KEY_PREFIX}:requests:${sessionId}`;
  }

  private responseKey(sessionId: string, requestId: string) {
    return `${KEY_PREFIX}:responses:${sessionId}:${requestId}`;
  }
}

export function createRedisPreviewRelayCoordinator() {
  const url = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL;
  return url ? new RedisPreviewRelayCoordinator(url) : undefined;
}
