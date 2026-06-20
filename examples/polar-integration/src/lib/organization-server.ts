import type { FarmIntegrationHandlerContext } from "@farmjs/core";
import type { PolarBillingOwner } from "@farmjs/integrations/polar";
import { auth } from "./auth.ts";

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
): Promise<PolarBillingOwner | null> {
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
