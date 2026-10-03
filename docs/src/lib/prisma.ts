import type { PrismaClient as PrismaClientType } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  farmDocsPrisma?: PrismaClientType;
  farmDocsWaitlistPrisma?: PrismaClientType;
};

type PrismaClientConstructor = new (options?: {
  log?: Array<"query" | "info" | "warn" | "error">;
  datasources?: { db: { url: string } };
}) => PrismaClientType;

type PrismaModule = {
  PrismaClient: PrismaClientConstructor;
};

const importRuntimeModule = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<PrismaModule>;

export async function getPrisma(): Promise<PrismaClientType> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!globalForPrisma.farmDocsPrisma) {
    const { PrismaClient } = await importRuntimeModule("@prisma/client");
    globalForPrisma.farmDocsPrisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }

  return globalForPrisma.farmDocsPrisma;
}

// Keep waitlist signups separate from telemetry when a dedicated database is
// configured. Existing installations can continue using DATABASE_URL alone.
export async function getWaitlistPrisma(): Promise<PrismaClientType> {
  const url = process.env.WAITLIST_DATABASE_URL;
  if (!url) return getPrisma();

  if (!globalForPrisma.farmDocsWaitlistPrisma) {
    const { PrismaClient } = await importRuntimeModule("@prisma/client");
    globalForPrisma.farmDocsWaitlistPrisma = new PrismaClient({
      datasources: { db: { url } },
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }

  return globalForPrisma.farmDocsWaitlistPrisma;
}
