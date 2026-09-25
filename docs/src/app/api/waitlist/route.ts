import { createHash } from "node:crypto";
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";
import { getPrisma } from "../../../lib/prisma";
import { createRateLimiter } from "../../../lib/rate-limit";

// Public, unauthenticated, and it writes to the database, so one caller must
// not be able to fill the table or overwrite entries in a loop. Mirrors the
// two-tier shape the telemetry endpoints use: a coarse global ceiling plus a
// per-address bucket, since the address is the row identity here.
const takeRateLimit = createRateLimiter({ maxEntries: 2_048 });
const GLOBAL_RATE_LIMIT = 240;
const EMAIL_RATE_LIMIT = 5;

const waitlistSchema = z.object({
  email: z.string().trim().email().max(200),
  description: z.string().trim().min(3).max(1200),
});

type WaitlistResult =
  | {
      ok: true;
      id: string;
    }
  | {
      ok: false;
      error: string;
    };

export const POST = createEndpoint(
  "/api/waitlist",
  { method: "POST", body: waitlistSchema },
  async (ctx): Promise<WaitlistResult | Response> => {
    const email = ctx.body.email.toLowerCase();
    const description = ctx.body.description;

    if (!takeRateLimit("global", GLOBAL_RATE_LIMIT)) {
      return Response.json({ ok: false, error: "Too many requests." }, { status: 429 });
    }
    const emailBucket = createHash("sha256").update(email).digest("hex");
    if (!takeRateLimit(`email:${emailBucket}`, EMAIL_RATE_LIMIT)) {
      return Response.json({ ok: false, error: "Too many requests." }, { status: 429 });
    }

    try {
      const prisma = await getPrisma();
      const entry = await prisma.waitlistEntry.upsert({
        where: { email },
        update: { description },
        create: { email, description },
        select: { id: true },
      });

      return { ok: true, id: entry.id };
    } catch (error) {
      console.error("[farmjs.waitlist]", error);

      return {
        ok: false,
        error: process.env.DATABASE_URL
          ? "Could not join the waitlist yet. Please try again in a moment."
          : "Waitlist database is not configured yet.",
      };
    }
  },
);
