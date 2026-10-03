import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const url = process.env.WAITLIST_DATABASE_URL;
if (!url) {
  console.error("Set WAITLIST_DATABASE_URL before running db:waitlist.");
  process.exitCode = 1;
} else {
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try {
    const sql = await readFile(new URL("../prisma/waitlist.sql", import.meta.url), "utf8");
    await prisma.$executeRawUnsafe(sql);
    console.log("Waitlist table is ready. Existing records and other tables were preserved.");
  } catch (error) {
    // Never print connection strings or provider error metadata from this script.
    console.error(`Waitlist setup failed (${error.code || "unknown"}). Check database access.`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
