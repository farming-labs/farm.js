import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeOrganizationBillingAdmin,
  canManageOrganizationBilling,
  type DemoOrganizationMember,
} from "./organization-server.ts";

/** The columns of the better-auth member row this gate actually reads. */
type MemberRow = Pick<DemoOrganizationMember, "organizationId" | "userId" | "role">;

const state = vi.hoisted(() => ({
  getSession: vi.fn(),
  members: [] as MemberRow[],
}));

// `./auth.ts` opens the demo SQLite database and runs better-auth migrations at
// import time, and `./prisma.ts` creates the demo tables, so both are stubbed.
// Everything under test (the session read, the member lookup, the role check)
// still runs for real.
vi.mock("./auth.ts", () => ({
  auth: {
    api: {
      getSession: state.getSession,
    },
  },
  authDatabase: {
    prepare: () => ({
      all: (organizationId: string) =>
        state.members.filter((member) => member.organizationId === organizationId),
      get: () => undefined,
    }),
  },
}));

vi.mock("./prisma.ts", () => ({
  prisma: {},
}));

const messages = {
  unauthenticatedError: "Create or activate an organization before editing seat overrides.",
  forbiddenError: "Only an organization owner or admin can change the seat allowance override.",
};

function member(userId: string, role: string): MemberRow {
  return { organizationId: "org_demo", userId, role };
}

function signIn(userId: string, activeOrganizationId: string | null = "org_demo") {
  state.getSession.mockResolvedValue({
    session: { activeOrganizationId },
    user: { id: userId, email: `${userId}@example.com`, name: userId },
  });
}

describe("authorizeOrganizationBillingAdmin", () => {
  beforeEach(() => {
    state.getSession.mockReset();
    state.members = [
      member("user_owner", "owner"),
      member("user_admin", "admin"),
      member("user_member", "member"),
      member("user_member_admin", "member,admin"),
      { organizationId: "org_other", userId: "user_outsider", role: "owner" },
    ];
  });

  it("refuses an unauthenticated caller with 401", async () => {
    state.getSession.mockResolvedValue(null);

    const authorization = await authorizeOrganizationBillingAdmin(new Headers(), messages);

    expect(authorization.ok).toBe(false);
    if (authorization.ok) {
      return;
    }

    expect(authorization.response.status).toBe(401);
    await expect(authorization.response.json()).resolves.toEqual({
      error: messages.unauthenticatedError,
    });
  });

  it("refuses a signed-in caller without an active organization with 401", async () => {
    signIn("user_owner", null);

    const authorization = await authorizeOrganizationBillingAdmin(new Headers(), messages);

    expect(authorization.ok).toBe(false);
    if (authorization.ok) {
      return;
    }

    expect(authorization.response.status).toBe(401);
  });

  it("refuses a plain member of the active organization with 403", async () => {
    signIn("user_member");

    const authorization = await authorizeOrganizationBillingAdmin(new Headers(), messages);

    expect(authorization.ok).toBe(false);
    if (authorization.ok) {
      return;
    }

    expect(authorization.response.status).toBe(403);
    await expect(authorization.response.json()).resolves.toEqual({
      error: messages.forbiddenError,
    });
  });

  it("refuses a signed-in user who is not a member of the active organization with 403", async () => {
    signIn("user_outsider");

    const authorization = await authorizeOrganizationBillingAdmin(new Headers(), messages);

    expect(authorization.ok).toBe(false);
    if (authorization.ok) {
      return;
    }

    expect(authorization.response.status).toBe(403);
  });

  it("allows an owner", async () => {
    signIn("user_owner");

    const authorization = await authorizeOrganizationBillingAdmin(new Headers(), messages);

    expect(authorization).toEqual({ ok: true, organizationId: "org_demo", role: "owner" });
  });

  it("allows an admin", async () => {
    signIn("user_admin");

    const authorization = await authorizeOrganizationBillingAdmin(new Headers(), messages);

    expect(authorization).toEqual({ ok: true, organizationId: "org_demo", role: "admin" });
  });

  it("allows a member who also holds the admin role", async () => {
    signIn("user_member_admin");

    const authorization = await authorizeOrganizationBillingAdmin(new Headers(), messages);

    expect(authorization.ok).toBe(true);
  });
});

describe("canManageOrganizationBilling", () => {
  it("accepts the owner and admin roles", () => {
    expect(canManageOrganizationBilling("owner")).toBe(true);
    expect(canManageOrganizationBilling("admin")).toBe(true);
    expect(canManageOrganizationBilling("OWNER")).toBe(true);
    expect(canManageOrganizationBilling("member, admin")).toBe(true);
  });

  it("rejects missing roles and roles below admin", () => {
    expect(canManageOrganizationBilling(null)).toBe(false);
    expect(canManageOrganizationBilling(undefined)).toBe(false);
    expect(canManageOrganizationBilling("")).toBe(false);
    expect(canManageOrganizationBilling("member")).toBe(false);
    expect(canManageOrganizationBilling("viewer,member")).toBe(false);
  });
});
