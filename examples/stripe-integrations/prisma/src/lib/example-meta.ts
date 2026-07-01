export const exampleMeta = {
  title: "Stripe + Better Auth + Prisma",
  target: "Prisma",
  generateCommand: "pnpm --dir examples/stripe-integrations/prisma generate",
  details:
    "Auto-detects Prisma from prisma/schema.prisma and appends the Stripe billing model block there.",
} as const;
