-- Dedicated waitlist database bootstrap, matching WaitlistEntry in schema.prisma.
-- Application-generated cuid IDs and updatedAt values are supplied by Prisma.
-- This does not create or modify telemetry tables, or drop existing records.
CREATE TABLE IF NOT EXISTS "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WaitlistEntry_email_key" UNIQUE ("email")
);
