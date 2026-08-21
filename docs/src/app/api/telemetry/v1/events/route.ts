import { createHmac } from "node:crypto";
import { getPrisma } from "../../../../../lib/prisma";
import { z } from "zod";

const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const GLOBAL_RATE_LIMIT = 2_000;
const IDENTITY_RATE_LIMIT = 120;
const MAX_RATE_LIMIT_ENTRIES = 4_096;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RETENTION_DAYS = 90;

const farmCommands = [
  "dev",
  "build",
  "auth:migrate",
  "upgrade",
  "generate",
  "doctor",
  "explain",
  "preview",
  "migrate",
  "cron:list",
  "cron:run",
  "add:integration",
  "deploy",
] as const;

const createAppCommands = ["create", "list-templates"] as const;

const templates = [
  "basic",
  "react-compiler",
  "auth",
  "better-auth",
  "ai",
  "auth0",
  "authjs",
  "autumn",
  "clerk",
  "jobs-inngest",
  "jobs-trigger",
  "polar",
  "resend",
  "stripe",
  "supabase",
  "unkey",
  "workos",
] as const;

const runtimeFields = {
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  anonymousId: z.string().uuid(),
  packageVersion: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[0-9A-Za-z.+_-]+$/),
  nodeMajor: z.number().int().min(16).max(99),
  platform: z.enum(["darwin", "linux", "windows", "other"]),
  architecture: z.enum(["arm64", "x64", "other"]),
};

const farmCommandEventSchema = z
  .object({
    ...runtimeFields,
    eventType: z.literal("command_invoked"),
    source: z.literal("cli"),
    packageName: z.literal("@farm.js/cli"),
    command: z.enum(farmCommands),
    deployTarget: z.enum(["vercel", "cloudflare", "netlify", "node", "custom"]).optional(),
  })
  .strict();

const createAppCommandEventSchema = z
  .object({
    ...runtimeFields,
    eventType: z.literal("command_invoked"),
    source: z.literal("create-app"),
    packageName: z.literal("@farm.js/create-app"),
    command: z.enum(createAppCommands),
  })
  .strict();

const projectCreatedEventSchema = z
  .object({
    ...runtimeFields,
    eventType: z.literal("project_created"),
    source: z.literal("create-app"),
    packageName: z.literal("@farm.js/create-app"),
    template: z.enum(templates).optional(),
    renderer: z.enum(["react", "preact", "solid", "vue", "svelte"]).optional(),
    packageManager: z.enum(["npm", "pnpm", "yarn", "bun"]).optional(),
    typescript: z.boolean().optional(),
    installedDependencies: z.boolean().optional(),
  })
  .strict();

const telemetryEventSchema = z.union([
  farmCommandEventSchema,
  createAppCommandEventSchema,
  projectCreatedEventSchema,
]);

type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
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

function identityHash(anonymousId: string, salt: string): string {
  return createHmac("sha256", salt).update(anonymousId).digest("hex");
}

function retentionDays(): number {
  const configured = Number.parseInt(process.env.FARM_TELEMETRY_RETENTION_DAYS || "", 10);
  return Number.isFinite(configured) && configured >= 1 && configured <= 3_650
    ? configured
    : DEFAULT_RETENTION_DAYS;
}

async function pruneExpiredEvents(prisma: Awaited<ReturnType<typeof getPrisma>>): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  const cutoff = new Date(now - retentionDays() * 24 * 60 * 60 * 1_000);
  try {
    await prisma.farmTelemetryEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  } catch (error) {
    console.error("[farmjs.telemetry.prune]", error);
  }
}

function databaseRecord(event: TelemetryEvent, hash: string) {
  return {
    eventId: event.eventId,
    schemaVersion: event.schemaVersion,
    eventType: event.eventType,
    identityHash: hash,
    source: event.source,
    packageName: event.packageName,
    packageVersion: event.packageVersion,
    command: event.eventType === "command_invoked" ? event.command : null,
    deployTarget: "deployTarget" in event ? event.deployTarget : null,
    template: event.eventType === "project_created" ? event.template : null,
    renderer: event.eventType === "project_created" ? event.renderer : null,
    packageManager: event.eventType === "project_created" ? event.packageManager : null,
    typescript: event.eventType === "project_created" ? event.typescript : null,
    installedDependencies:
      event.eventType === "project_created" ? event.installedDependencies : null,
    nodeMajor: event.nodeMajor,
    platform: event.platform,
    architecture: event.architecture,
  };
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

  const parsed = telemetryEventSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_event" }, 400);
  }

  const salt = process.env.FARM_TELEMETRY_IDENTITY_SALT;
  if (!salt) {
    return json({ ok: true, stored: false, warning: "telemetry_not_configured" }, 202);
  }
  const hash = identityHash(parsed.data.anonymousId, salt);
  if (!takeRateLimit(`identity:${hash}`, IDENTITY_RATE_LIMIT)) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  if (!process.env.DATABASE_URL) {
    return json({ ok: true, stored: false, warning: "database_not_configured" }, 202);
  }

  try {
    const prisma = await getPrisma();
    const record = databaseRecord(parsed.data, hash);
    await prisma.farmTelemetryEvent.upsert({
      where: { eventId: parsed.data.eventId },
      update: {},
      create: record,
    });
    await pruneExpiredEvents(prisma);
    return json({ ok: true, stored: true }, 202);
  } catch (error) {
    console.error("[farmjs.telemetry.ingest]", error);
    return json({ ok: true, stored: false, warning: "database_unavailable" }, 202);
  }
}
