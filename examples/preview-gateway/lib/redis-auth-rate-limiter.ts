import { createHash } from "node:crypto";

import type {
  PreviewAuthExchangeRateLimiter,
  PreviewAuthExchangeRateLimitResult,
} from "@farm.js/preview-gateway";
import Redis from "ioredis";

const KEY_PREFIX = "farm-preview:auth-exchange";
const WINDOW_MS = 60_000;
const MAX_EXCHANGES_PER_WINDOW = 10;

const TAKE_AUTH_EXCHANGE_SLOT_SCRIPT = `
  local count = redis.call("INCR", KEYS[1])
  if count == 1 then
    redis.call("PEXPIRE", KEYS[1], ARGV[1])
  end
  return { count, redis.call("PTTL", KEYS[1]) }
`;

class RedisPreviewAuthExchangeRateLimiter {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, {
      connectionName: "farm-preview-auth-exchange",
      connectTimeout: 5_000,
      enableReadyCheck: true,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    this.redis.on("error", () => undefined);
  }

  async check(request: Request): Promise<PreviewAuthExchangeRateLimitResult> {
    const clientAddress = readVercelClientAddress(request.headers);
    const addressHash = createHash("sha256").update(clientAddress).digest("hex");
    const result = (await this.redis.eval(
      TAKE_AUTH_EXCHANGE_SLOT_SCRIPT,
      1,
      `${KEY_PREFIX}:${addressHash}`,
      WINDOW_MS,
    )) as [number | string, number | string];
    const count = Number(result[0]);
    const retryAfterMs = Math.max(1, Number(result[1]));
    return count <= MAX_EXCHANGES_PER_WINDOW
      ? { allowed: true }
      : { allowed: false, retryAfterMs };
  }
}

export function createRedisPreviewAuthExchangeRateLimiter():
  | PreviewAuthExchangeRateLimiter
  | undefined {
  const url = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL;
  if (!url) return undefined;
  const limiter = new RedisPreviewAuthExchangeRateLimiter(url);
  return (request) => limiter.check(request);
}

function readVercelClientAddress(headers: Headers) {
  // Vercel overwrites x-forwarded-for at the edge. Prefer it over the retained
  // x-vercel-forwarded-for chain, then keep local/self-hosted development usable.
  const value =
    headers.get("x-forwarded-for") ||
    headers.get("x-vercel-forwarded-for") ||
    headers.get("x-real-ip") ||
    "unknown";
  return value.split(",", 1)[0]?.trim() || "unknown";
}
