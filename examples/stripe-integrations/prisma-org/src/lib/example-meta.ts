export const exampleMeta = {
  title: "Stripe + Better Auth + Prisma (Organizations)",
  target: "Prisma Org",
  generateCommand: "pnpm --dir examples/stripe-integrations/prisma-org generate",
  details:
    "Auto-detects Prisma, keeps Better Auth organizations in SQLite, and bills the active org instead of the signed-in user.",
} as const;
