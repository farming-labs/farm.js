import { createHash } from "node:crypto";
import {
  FARM_PRODUCTION_SITE_TELEMETRY_EVENT_TYPE,
  FARM_PRODUCTION_SITE_TELEMETRY_PACKAGE_NAME,
  FARM_PRODUCTION_SITE_TELEMETRY_SCHEMA_VERSION,
  normalizeFarmProductionSiteOrigin,
} from "../../../../../../../packages/farm/src/product-telemetry";
import { getPrisma } from "../../../../../lib/prisma";
import { z } from "zod";

const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const GLOBAL_RATE_LIMIT = 1_000;
const SITE_RATE_LIMIT = 30;
const MAX_RATE_LIMIT_ENTRIES = 2_048;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RETENTION_DAYS = 90;
const SAFE_DETAIL_PATTERN = /^[0-9A-Za-z._-]{1,64}$/;

const productionSiteSchema = z
  .object({
    schemaVersion: z.literal(FARM_PRODUCTION_SITE_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal(FARM_PRODUCTION_SITE_TELEMETRY_EVENT_TYPE),
    siteUrl: z
      .string()
      .min(1)
      .max(2_048)
      .refine((value) => normalizeFarmProductionSiteOrigin(value) === value),
    packageName: z.literal(FARM_PRODUCTION_SITE_TELEMETRY_PACKAGE_NAME),
    packageVersion: z.string().regex(SAFE_DETAIL_PATTERN),
    renderer: z.string().regex(SAFE_DETAIL_PATTERN),
    deployTarget: z.string().regex(SAFE_DETAIL_PATTERN),
  })
  .strict();

type RateLimitBucket = { count: number; startedAt: number };

const rateLimitBuckets = new Map<string, RateLimitBucket>();
let lastPruneAt = 0;

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function takeRateLimit(key: string, limit: number, now = Date.now()): boolean {
  const current = rateLimitBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { count: 1, startedAt: now });
    if (rateLimitBuckets.size > MAX_RATE_LIMIT_ENTRIES) {
      for (const [bucketKey, bucket] of rateLimitBuckets) {
        if (now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) rateLimitBuckets.delete(bucketKey);
      }
    }
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function retentionDays(): number {
  const configured = Number.parseInt(process.env.FARM_TELEMETRY_RETENTION_DAYS || "", 10);
  return Number.isFinite(configured) && configured >= 1 && configured <= 3_650
    ? configured
    : DEFAULT_RETENTION_DAYS;
}

async function pruneInactiveSites(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  now = Date.now(),
): Promise<void> {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  const cutoff = new Date(now - retentionDays() * 24 * 60 * 60 * 1_000);
  try {
    await prisma.farmProductionSite.deleteMany({ where: { lastSeenAt: { lt: cutoff } } });
  } catch (error) {
    console.error("[farmjs.telemetry.site-prune]", error);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!takeRateLimit("global", GLOBAL_RATE_LIMIT)) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) {
    return json({ ok: false, error: "content_type" }, 415);
  }
  const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "payload_too_large" }, 413);
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: "payload_too_large" }, 413);
    }
    body = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const parsed = productionSiteSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_site" }, 400);
  }
  const siteBucket = createHash("sha256").update(parsed.data.siteUrl).digest("hex");
  if (!takeRateLimit(`site:${siteBucket}`, SITE_RATE_LIMIT)) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  if (!process.env.DATABASE_URL) {
    return json({ ok: true, stored: false, warning: "database_not_configured" }, 202);
  }

  try {
    const prisma = await getPrisma();
    const now = new Date();
    await prisma.farmProductionSite.upsert({
      where: { url: parsed.data.siteUrl },
      update: {
        packageName: parsed.data.packageName,
        packageVersion: parsed.data.packageVersion,
        renderer: parsed.data.renderer,
        deployTarget: parsed.data.deployTarget,
        lastSeenAt: now,
      },
      create: {
        url: parsed.data.siteUrl,
        packageName: parsed.data.packageName,
        packageVersion: parsed.data.packageVersion,
        renderer: parsed.data.renderer,
        deployTarget: parsed.data.deployTarget,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
    await pruneInactiveSites(prisma, now.getTime());
    return json({ ok: true, stored: true }, 202);
  } catch (error) {
    console.error("[farmjs.telemetry.site-ingest]", error);
    return json({ ok: true, stored: false, warning: "database_unavailable" }, 202);
  }
}
