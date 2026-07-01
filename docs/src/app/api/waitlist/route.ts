import { createEndpoint } from "@farmjs/core/api";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { z } from "zod";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientType;
};

type PrismaClientConstructor = new (options?: {
  log?: Array<"query" | "info" | "warn" | "error">;
}) => PrismaClientType;

type PrismaModule = {
  PrismaClient: PrismaClientConstructor;
};

const importRuntimeModule = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<PrismaModule>;

async function getPrisma() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!globalForPrisma.prisma) {
    const { PrismaClient } = await importRuntimeModule("@prisma/client");

    globalForPrisma.prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }

  return globalForPrisma.prisma;
}

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
  async (ctx): Promise<WaitlistResult> => {
    const parsed = waitlistSchema.safeParse(ctx.body);

    if (!parsed.success) {
      return {
        ok: false,
        error: "Add a valid email and what you want to see from Farm.js.",
      };
    }

    const email = parsed.data.email.toLowerCase();
    const description = parsed.data.description;

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
