import type { FarmIntegrationHandlerContext } from "@farm.js/core";
import type { StripeBillingOwner } from "@farm.js/stripe";
import { auth, authDatabase } from "./auth.ts";
import { prisma } from "./prisma.ts";

export interface DemoSessionUser {
  id: string;
  email: string | null;
  name: string | null;
}

export interface DemoSessionState {
  activeOrganizationId?: string | null;
}

export interface DemoAuthSession {
  session: DemoSessionState;
  user: DemoSessionUser;
}

export interface DemoOrganization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: string;
  metadata: string | null;
}

export interface DemoOrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: string;
  userEmail: string | null;
  userName: string | null;
}

export interface DemoOrganizationInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  inviterId: string;
  inviterEmail: string | null;
  inviterName: string | null;
  organizationName: string | null;
}

type SessionResponse = {
  session?: {
    activeOrganizationId?: string | null;
  } | null;
  user?: {
    id?: string;
    email?: string | null;
    name?: string | null;
  } | null;
} | null;

function createLocalId() {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return randomId;
  }

  return `farm-org-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function startOfCurrentUtcMonth() {
  const value = new Date();
  value.setUTCDate(1);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

export async function getAuthSession(headers: Headers): Promise<DemoAuthSession | null> {
  const session = await (auth.api as {
    getSession(input: { headers: Headers }): Promise<SessionResponse>;
  }).getSession({
    headers,
  });

  if (!session?.user?.id) {
    return null;
  }

  return {
    session: {
      activeOrganizationId: session.session?.activeOrganizationId ?? null,
    },
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    },
  };
}

export async function resolveOrganizationBillingOwner(
  context: FarmIntegrationHandlerContext,
): Promise<StripeBillingOwner | null> {
  const session = await getAuthSession(context.request.headers);
  const organizationId = session?.session.activeOrganizationId;

  if (!session || !organizationId) {
    return null;
  }

  return {
    kind: "organization",
    id: organizationId,
    email: session.user.email ?? undefined,
  };
}

export function listOrganizationsForUser(userId: string): DemoOrganization[] {
  const rows = authDatabase
    .prepare(
      `
        SELECT o.id, o.name, o.slug, o.logo, o.createdAt, o.metadata
        FROM "member" AS m
        INNER JOIN "organization" AS o ON o.id = m.organizationId
        WHERE m.userId = ?
        ORDER BY o.createdAt DESC
      `,
    )
    .all(userId) as DemoOrganization[];

  return rows;
}

export function getOrganizationById(organizationId: string): DemoOrganization | null {
  const row = authDatabase
    .prepare(
      `
        SELECT id, name, slug, logo, createdAt, metadata
        FROM "organization"
        WHERE id = ?
      `,
    )
    .get(organizationId) as DemoOrganization | undefined;

  return row ?? null;
}

export function listOrganizationMembers(
  organizationId: string,
): DemoOrganizationMember[] {
  const rows = authDatabase
    .prepare(
      `
        SELECT
          m.id,
          m.organizationId,
          m.userId,
          m.role,
          m.createdAt,
          u.email AS userEmail,
          u.name AS userName
        FROM "member" AS m
        INNER JOIN "user" AS u ON u.id = m.userId
        WHERE m.organizationId = ?
        ORDER BY m.createdAt ASC
      `,
    )
    .all(organizationId) as DemoOrganizationMember[];

  return rows;
}

export function listOrganizationInvitations(
  organizationId: string,
): DemoOrganizationInvitation[] {
  const rows = authDatabase
    .prepare(
      `
        SELECT
          i.id,
          i.organizationId,
          i.email,
          i.role,
          i.status,
          i.expiresAt,
          i.createdAt,
          i.inviterId,
          u.email AS inviterEmail,
          u.name AS inviterName,
          o.name AS organizationName
        FROM "invitation" AS i
        INNER JOIN "organization" AS o ON o.id = i.organizationId
        INNER JOIN "user" AS u ON u.id = i.inviterId
        WHERE i.organizationId = ?
        ORDER BY i.createdAt DESC
      `,
    )
    .all(organizationId) as DemoOrganizationInvitation[];

  return rows;
}

export function listUserInvitations(
  email: string,
): DemoOrganizationInvitation[] {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return [];
  }

  const rows = authDatabase
    .prepare(
      `
        SELECT
          i.id,
          i.organizationId,
          i.email,
          i.role,
          i.status,
          i.expiresAt,
          i.createdAt,
          i.inviterId,
          u.email AS inviterEmail,
          u.name AS inviterName,
          o.name AS organizationName
        FROM "invitation" AS i
        INNER JOIN "organization" AS o ON o.id = i.organizationId
        INNER JOIN "user" AS u ON u.id = i.inviterId
        WHERE lower(i.email) = ?
        ORDER BY i.createdAt DESC
      `,
    )
    .all(normalizedEmail) as DemoOrganizationInvitation[];

  return rows;
}

export function countOrganizationMembers(organizationId: string): number {
  const result = authDatabase
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM "member"
        WHERE "organizationId" = ?
      `,
    )
    .get(organizationId) as { count?: number } | undefined;

  return Number(result?.count ?? 0);
}

export function countPendingOrganizationInvitations(
  organizationId: string,
): number {
  const result = authDatabase
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM "invitation"
        WHERE "organizationId" = ?
          AND lower("status") = 'pending'
      `,
    )
    .get(organizationId) as { count?: number } | undefined;

  return Number(result?.count ?? 0);
}

export function countReservedOrganizationSeats(organizationId: string): number {
  return (
    countOrganizationMembers(organizationId) +
    countPendingOrganizationInvitations(organizationId)
  );
}

export async function countOrganizationProjects(
  organizationId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number | bigint }>>`
    SELECT COUNT(*) AS count
    FROM "organization_project"
    WHERE "organization_id" = ${organizationId}
      AND "archived" = 0
  `;

  const count = rows[0]?.count ?? 0;
  return typeof count === "bigint" ? Number(count) : Number(count);
}

export async function sumOrganizationTokensThisMonth(
  organizationId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: number | bigint | null }>>`
    SELECT COALESCE(SUM("tokens"), 0) AS total
    FROM "organization_token_usage"
    WHERE "organization_id" = ${organizationId}
      AND "created_at" >= ${startOfCurrentUtcMonth().toISOString()}
  `;

  const total = rows[0]?.total ?? 0;
  return typeof total === "bigint" ? Number(total) : Number(total);
}

export async function setOrganizationSeatAllowanceOverride(
  organizationId: string,
  seatAllowanceOverride: number | null,
): Promise<number | null> {
  await prisma.$executeRaw`
    INSERT INTO "billing_account" (
      "id",
      "owner_id",
      "owner_kind",
      "plan_id",
      "status",
      "cancel_at_period_end",
      "seat_allowance_override",
      "created_at",
      "updated_at"
    ) VALUES (
      ${createLocalId()},
      ${organizationId},
      'organization',
      'free',
      'free',
      0,
      ${seatAllowanceOverride},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT("owner_kind", "owner_id")
    DO UPDATE SET
      "seat_allowance_override" = ${seatAllowanceOverride},
      "updated_at" = CURRENT_TIMESTAMP
  `;

  return seatAllowanceOverride;
}

export async function insertDemoProject(
  organizationId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const id = createLocalId();

  await prisma.$executeRaw`
    INSERT INTO "organization_project" (
      "id",
      "organization_id",
      "name",
      "archived",
      "created_at"
    ) VALUES (
      ${id},
      ${organizationId},
      ${name},
      ${0},
      ${new Date().toISOString()}
    )
  `;

  return { id, name };
}

export async function insertDemoTokenUsage(
  organizationId: string,
  tokens: number,
): Promise<{ id: string; tokens: number }> {
  const id = createLocalId();

  await prisma.$executeRaw`
    INSERT INTO "organization_token_usage" (
      "id",
      "organization_id",
      "tokens",
      "created_at"
    ) VALUES (
      ${id},
      ${organizationId},
      ${tokens},
      ${new Date().toISOString()}
    )
  `;

  return { id, tokens };
}
